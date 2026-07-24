import { createHash, randomBytes } from "node:crypto";

export type GitHubInstallationState =
  "pending-confirmation" | "connected" | "attention-required" | "suspended" | "removed";

export type AttestedInstallation = {
  installationId: string;
  accountLogin: string;
  accountType: "Organization" | "User";
  repositories: GitHubRepository[];
  permissions: { checks: "read"; issues: "read"; pullRequests: "read" };
  active: boolean;
};

export type GitHubRepository = { id: string; fullName: string; archived?: boolean };

export interface GitHubInstallationAttestor {
  attest(installationId: string): Promise<AttestedInstallation>;
}

type InstallState = {
  nonceHash: string;
  actorId: string;
  workspaceId: string;
  returnTo: string;
  intendedAccount: string;
  retentionPolicyId: string;
  expiresAt: number;
  used: boolean;
};

export type GitHubInstallation = AttestedInstallation & {
  workspaceId: string;
  retentionPolicyId: string;
  mappingVersion: number;
  state: GitHubInstallationState;
  connectedAt?: string;
};

export type GitHubInstallationResolution =
  | { ok: true; installation: GitHubInstallation }
  | {
      ok: false;
      reason:
        | "installation-not-found"
        | "installation-not-connected"
        | "repository-not-installed"
        | "repository-archived";
    };

function hasExactReadPermissions(permissions: AttestedInstallation["permissions"]): boolean {
  return (
    permissions?.checks === "read" &&
    permissions?.issues === "read" &&
    permissions?.pullRequests === "read" &&
    Object.keys(permissions).length === 3
  );
}

/**
 * Server-side source of truth for hosted GitHub App bindings. This is deliberately
 * dependency-injected so the production persistence layer can enforce the same
 * installation-id uniqueness transactionally; no browser or webhook claim is trusted.
 */
export class GitHubInstallationRegistry {
  #states = new Map<string, InstallState>();
  #installations = new Map<string, GitHubInstallation>();

  start(input: {
    actorId: string;
    workspaceId: string;
    returnTo: string;
    intendedAccount: string;
    retentionPolicyId: string;
    now?: Date;
  }): string {
    const now = input.now?.getTime() ?? Date.now();
    for (const [nonceHash, state] of this.#states) {
      if (state.used || state.expiresAt <= now) this.#states.delete(nonceHash);
    }
    const nonce = randomBytes(32).toString("base64url");
    this.#states.set(this.hash(nonce), {
      nonceHash: this.hash(nonce),
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      returnTo: input.returnTo,
      intendedAccount: input.intendedAccount,
      retentionPolicyId: input.retentionPolicyId,
      expiresAt: now + 10 * 60_000,
      used: false,
    });
    return nonce;
  }

  async attestCallback(input: {
    nonce: string;
    actorId: string;
    workspaceId: string;
    installationId: string;
    attestor: GitHubInstallationAttestor;
    now?: Date;
  }): Promise<GitHubInstallation> {
    const state = this.#states.get(this.hash(input.nonce));
    if (!state || state.used || state.expiresAt <= (input.now?.getTime() ?? Date.now()))
      throw new Error("GitHub installation state is invalid, expired, or already used.");
    if (state.actorId !== input.actorId || state.workspaceId !== input.workspaceId)
      throw new Error("GitHub installation state is not bound to this actor and workspace.");
    state.used = true;
    try {
      const attested = await input.attestor.attest(input.installationId);
      if (
        !attested.active ||
        attested.installationId !== input.installationId ||
        attested.accountLogin !== state.intendedAccount
      )
        throw new Error(
          "GitHub installation attestation did not match the requested installation and intended account.",
        );
      if (!hasExactReadPermissions(attested.permissions))
        throw new Error("GitHub installation does not have the exact required read permissions.");
      const existing = this.#installations.get(attested.installationId);
      if (existing && existing.workspaceId !== state.workspaceId)
        throw new Error("GitHub installation is already bound to another workspace.");
      const installation: GitHubInstallation = {
        ...attested,
        repositories: attested.repositories.map((repository) => ({ ...repository })),
        permissions: { ...attested.permissions },
        workspaceId: state.workspaceId,
        retentionPolicyId: state.retentionPolicyId,
        mappingVersion: (existing?.mappingVersion ?? 0) + 1,
        state: "pending-confirmation",
      };
      this.#installations.set(installation.installationId, installation);
      return this.snapshot(installation);
    } finally {
      this.#states.delete(state.nonceHash);
    }
  }

  confirm(installationId: string, workspaceId: string, now = new Date()): GitHubInstallation {
    const installation = this.require(installationId, workspaceId);
    if (installation.state !== "pending-confirmation")
      throw new Error("GitHub installation is not awaiting confirmation.");
    installation.state = "connected";
    installation.connectedAt = now.toISOString();
    return this.snapshot(installation);
  }

  get(installationId: string, workspaceId: string): GitHubInstallation {
    return this.snapshot(this.require(installationId, workspaceId));
  }

  resolve(installationId: string, repository: string): GitHubInstallationResolution {
    const installation = this.#installations.get(installationId);
    if (!installation) return { ok: false, reason: "installation-not-found" };
    if (installation.state !== "connected")
      return { ok: false, reason: "installation-not-connected" };
    const mappedRepository = installation.repositories.find((item) => item.fullName === repository);
    if (!mappedRepository) return { ok: false, reason: "repository-not-installed" };
    if (mappedRepository.archived) return { ok: false, reason: "repository-archived" };
    return { ok: true, installation: this.snapshot(installation) };
  }

  replaceRepositories(installationId: string, repositories: GitHubRepository[]): void {
    const installation = this.#installations.get(installationId);
    if (!installation || installation.state === "removed")
      throw new Error("GitHub installation is not available for repository reconciliation.");
    installation.repositories = repositories.map((repository) => ({ ...repository }));
  }

  revoke(
    installationId: string,
    state: Extract<GitHubInstallationState, "attention-required" | "suspended" | "removed">,
  ): void {
    const installation = this.#installations.get(installationId);
    if (installation) installation.state = state;
  }

  private require(installationId: string, workspaceId: string): GitHubInstallation {
    const installation = this.#installations.get(installationId);
    if (!installation || installation.workspaceId !== workspaceId)
      throw new Error("GitHub installation is not mapped to this workspace.");
    return installation;
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private snapshot(installation: GitHubInstallation): GitHubInstallation {
    return {
      ...installation,
      repositories: installation.repositories.map((repository) => ({ ...repository })),
      permissions: { ...installation.permissions },
    };
  }
}
