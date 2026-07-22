import { createHash, randomBytes } from "node:crypto";

export type GitHubInstallationState =
  | "pending-confirmation"
  | "connected"
  | "attention-required"
  | "suspended"
  | "removed";

export type AttestedInstallation = {
  installationId: string;
  accountLogin: string;
  accountType: "Organization" | "User";
  repositories: Array<{ id: string; fullName: string; archived?: boolean }>;
  permissions: { checks: "read"; issues: "read"; pullRequests: "read" };
  active: boolean;
};

export interface GitHubInstallationAttestor {
  attest(installationId: string): Promise<AttestedInstallation>;
}

type InstallState = {
  nonceHash: string;
  actorId: string;
  workspaceId: string;
  returnTo: string;
  intendedAccount: string;
  expiresAt: number;
  used: boolean;
};

export type GitHubInstallation = AttestedInstallation & {
  workspaceId: string;
  state: GitHubInstallationState;
  connectedAt?: string;
};

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
    now?: Date;
  }): string {
    const nonce = randomBytes(32).toString("base64url");
    this.#states.set(this.hash(nonce), {
      nonceHash: this.hash(nonce),
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      returnTo: input.returnTo,
      intendedAccount: input.intendedAccount,
      expiresAt: (input.now?.getTime() ?? Date.now()) + 10 * 60_000,
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
    const attested = await input.attestor.attest(input.installationId);
    if (!attested.active || attested.accountLogin !== state.intendedAccount)
      throw new Error("GitHub installation attestation did not match the intended account.");
    if (Object.values(attested.permissions).some((permission) => permission !== "read"))
      throw new Error("GitHub installation has unsupported permissions.");
    const existing = this.#installations.get(attested.installationId);
    if (existing && existing.workspaceId !== state.workspaceId)
      throw new Error("GitHub installation is already bound to another workspace.");
    const installation: GitHubInstallation = {
      ...attested,
      workspaceId: state.workspaceId,
      state: "pending-confirmation",
    };
    this.#installations.set(installation.installationId, installation);
    return installation;
  }

  confirm(installationId: string, workspaceId: string): GitHubInstallation {
    const installation = this.require(installationId, workspaceId);
    if (installation.state !== "pending-confirmation")
      throw new Error("GitHub installation is not awaiting confirmation.");
    installation.state = "connected";
    installation.connectedAt = new Date().toISOString();
    return installation;
  }

  resolve(installationId: string, repository: string): GitHubInstallation | undefined {
    const installation = this.#installations.get(installationId);
    if (
      !installation ||
      installation.state !== "connected" ||
      !installation.repositories.some((item) => item.fullName === repository && !item.archived)
    )
      return undefined;
    return installation;
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
}
