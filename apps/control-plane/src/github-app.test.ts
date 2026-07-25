import { describe, expect, it } from "vitest";
import {
  GitHubInstallationRegistry,
  type AttestedInstallation,
  type GitHubInstallationAttestor,
} from "./github-app.js";

const attestor: GitHubInstallationAttestor = {
  attest: async (installationId) => ({
    installationId,
    accountLogin: "acme",
    accountType: "Organization",
    repositories: [
      { id: "1", fullName: "acme/service" },
      { id: "2", fullName: "acme/archive", archived: true },
    ],
    permissions: { checks: "read", issues: "read", pullRequests: "read" },
    active: true,
  }),
};

function start(
  registry: GitHubInstallationRegistry,
  workspaceId = "workspace-a",
  now?: Date,
): string {
  return registry.start({
    actorId: "owner",
    workspaceId,
    returnTo: "/connections",
    intendedAccount: "acme",
    retentionPolicyId: "retain-30-days",
    now,
  });
}

describe("GitHubInstallationRegistry", () => {
  it("binds a single-use, expiring nonce before any installation can gain tenant authority", async () => {
    const registry = new GitHubInstallationRegistry();
    const now = new Date("2026-01-01T00:00:00Z");
    const nonce = start(registry, "workspace-a", now);
    await expect(
      registry.attestCallback({
        nonce,
        actorId: "other",
        workspaceId: "workspace-a",
        installationId: "42",
        attestor,
        now,
      }),
    ).rejects.toThrow("not bound");
    await registry.attestCallback({
      nonce,
      actorId: "owner",
      workspaceId: "workspace-a",
      installationId: "42",
      attestor,
      now,
    });
    await expect(
      registry.attestCallback({
        nonce,
        actorId: "owner",
        workspaceId: "workspace-a",
        installationId: "42",
        attestor,
        now,
      }),
    ).rejects.toThrow("invalid");

    const expired = start(registry, "workspace-a", now);
    await expect(
      registry.attestCallback({
        nonce: expired,
        actorId: "owner",
        workspaceId: "workspace-a",
        installationId: "43",
        attestor,
        now: new Date(now.getTime() + 600_001),
      }),
    ).rejects.toThrow("expired");
  });

  it("consumes a callback nonce before attestation so failures and concurrent retries fail closed", async () => {
    const registry = new GitHubInstallationRegistry();
    let finishAttestation: ((value: AttestedInstallation) => void) | undefined;
    let attestationCalls = 0;
    const concurrentAttestor: GitHubInstallationAttestor = {
      attest: () => {
        attestationCalls += 1;
        return new Promise<AttestedInstallation>((resolve) => {
          finishAttestation = resolve;
        });
      },
    };
    const nonce = start(registry);
    const first = registry.attestCallback({
      nonce,
      actorId: "owner",
      workspaceId: "workspace-a",
      installationId: "42",
      attestor: concurrentAttestor,
    });
    await expect(
      registry.attestCallback({
        nonce,
        actorId: "owner",
        workspaceId: "workspace-a",
        installationId: "42",
        attestor: concurrentAttestor,
      }),
    ).rejects.toThrow("already used");
    finishAttestation?.(await attestor.attest("42"));
    await first;
    expect(attestationCalls).toBe(1);

    const failedNonce = start(registry);
    const failingAttestor: GitHubInstallationAttestor = {
      attest: async () => {
        throw new Error("GitHub API unavailable");
      },
    };
    await expect(
      registry.attestCallback({
        nonce: failedNonce,
        actorId: "owner",
        workspaceId: "workspace-a",
        installationId: "43",
        attestor: failingAttestor,
      }),
    ).rejects.toThrow("GitHub API unavailable");
    await expect(
      registry.attestCallback({
        nonce: failedNonce,
        actorId: "owner",
        workspaceId: "workspace-a",
        installationId: "43",
        attestor,
      }),
    ).rejects.toThrow("invalid");
  });

  it("requires every exact read permission and explicit confirmation", async () => {
    const registry = new GitHubInstallationRegistry();
    const wrongInstallationAttestor: GitHubInstallationAttestor = {
      attest: async () => attestor.attest("different-installation"),
    };
    await expect(
      registry.attestCallback({
        nonce: start(registry),
        actorId: "owner",
        workspaceId: "workspace-a",
        installationId: "40",
        attestor: wrongInstallationAttestor,
      }),
    ).rejects.toThrow("requested installation");

    const incompleteAttestor: GitHubInstallationAttestor = {
      attest: async (installationId) => ({
        ...(await attestor.attest(installationId)),
        permissions: { checks: "read", pullRequests: "read" } as Awaited<
          ReturnType<typeof attestor.attest>
        >["permissions"],
      }),
    };
    await expect(
      registry.attestCallback({
        nonce: start(registry),
        actorId: "owner",
        workspaceId: "workspace-a",
        installationId: "41",
        attestor: incompleteAttestor,
      }),
    ).rejects.toThrow("exact required read permissions");

    const pending = await registry.attestCallback({
      nonce: start(registry),
      actorId: "owner",
      workspaceId: "workspace-a",
      installationId: "42",
      attestor,
    });
    expect(registry.resolve("42", "acme/service")).toEqual({
      ok: false,
      reason: "installation-not-connected",
    });
    registry.confirm(pending.installationId, "workspace-a");
    expect(() => registry.confirm(pending.installationId, "workspace-a")).toThrow(
      "not awaiting confirmation",
    );
  });

  it("denies archived, removed, and no-longer-selected repositories while retaining policy linkage", async () => {
    const registry = new GitHubInstallationRegistry();
    const pending = await registry.attestCallback({
      nonce: start(registry),
      actorId: "owner",
      workspaceId: "workspace-a",
      installationId: "42",
      attestor,
    });
    registry.confirm(pending.installationId, "workspace-a");
    expect(registry.resolve("42", "acme/service")).toMatchObject({
      ok: true,
      installation: { workspaceId: "workspace-a", retentionPolicyId: "retain-30-days" },
    });
    expect(registry.resolve("42", "acme/archive")).toEqual({
      ok: false,
      reason: "repository-archived",
    });
    registry.replaceRepositories("42", [{ id: "2", fullName: "acme/other" }]);
    expect(registry.resolve("42", "acme/service")).toEqual({
      ok: false,
      reason: "repository-not-installed",
    });
    registry.revoke("42", "removed");
    expect(registry.resolve("42", "acme/other")).toEqual({
      ok: false,
      reason: "installation-not-connected",
    });
    expect(registry.get("42", "workspace-a")).toMatchObject({
      state: "removed",
      retentionPolicyId: "retain-30-days",
    });
    expect(() =>
      registry.replaceRepositories("42", [{ id: "1", fullName: "acme/service" }]),
    ).toThrow("not available");
  });

  it("requires explicit remapping after reinstall and never restores an old confirmation", async () => {
    const registry = new GitHubInstallationRegistry();
    const first = await registry.attestCallback({
      nonce: start(registry),
      actorId: "owner",
      workspaceId: "workspace-a",
      installationId: "42",
      attestor,
    });
    registry.confirm(first.installationId, "workspace-a");
    registry.revoke(first.installationId, "removed");

    const reinstalled = await registry.attestCallback({
      nonce: start(registry),
      actorId: "owner",
      workspaceId: "workspace-a",
      installationId: "42",
      attestor,
    });
    expect(reinstalled).toMatchObject({
      state: "pending-confirmation",
      mappingVersion: 2,
    });
    expect(reinstalled.connectedAt).toBeUndefined();
    expect(registry.resolve("42", "acme/service")).toEqual({
      ok: false,
      reason: "installation-not-connected",
    });
  });

  it("never lets an installation cross workspace boundaries", async () => {
    const registry = new GitHubInstallationRegistry();
    await registry.attestCallback({
      nonce: start(registry),
      actorId: "owner",
      workspaceId: "workspace-a",
      installationId: "42",
      attestor,
    });
    await expect(
      registry.attestCallback({
        nonce: start(registry, "workspace-b"),
        actorId: "owner",
        workspaceId: "workspace-b",
        installationId: "42",
        attestor,
      }),
    ).rejects.toThrow("another workspace");
  });
});
