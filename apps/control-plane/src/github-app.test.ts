import { describe, expect, it } from "vitest";
import { GitHubInstallationRegistry, type GitHubInstallationAttestor } from "./github-app.js";

const attestor: GitHubInstallationAttestor = {
  attest: async (installationId) => ({
    installationId,
    accountLogin: "acme",
    accountType: "Organization",
    repositories: [{ id: "1", fullName: "acme/service" }],
    permissions: { checks: "read", issues: "read", pullRequests: "read" },
    active: true,
  }),
};

describe("GitHubInstallationRegistry", () => {
  it("binds a single-use, expiring nonce to the actor and workspace before attestation", async () => {
    const registry = new GitHubInstallationRegistry();
    const now = new Date("2026-01-01T00:00:00Z");
    const nonce = registry.start({
      actorId: "owner",
      workspaceId: "a",
      returnTo: "/connections",
      intendedAccount: "acme",
      now,
    });
    await expect(
      registry.attestCallback({ nonce, actorId: "other", workspaceId: "a", installationId: "42", attestor, now }),
    ).rejects.toThrow("not bound");
    await registry.attestCallback({ nonce, actorId: "owner", workspaceId: "a", installationId: "42", attestor, now });
    await expect(
      registry.attestCallback({ nonce, actorId: "owner", workspaceId: "a", installationId: "42", attestor, now }),
    ).rejects.toThrow("already used");
    const expired = registry.start({
      actorId: "owner",
      workspaceId: "a",
      returnTo: "/connections",
      intendedAccount: "acme",
      now,
    });
    await expect(
      registry.attestCallback({
        nonce: expired,
        actorId: "owner",
        workspaceId: "a",
        installationId: "43",
        attestor,
        now: new Date(now.getTime() + 600_001),
      }),
    ).rejects.toThrow("expired");
  });

  it("requires attested account, exact read permissions, confirmation, and repo scope", async () => {
    const registry = new GitHubInstallationRegistry();
    const nonce = registry.start({ actorId: "owner", workspaceId: "a", returnTo: "/connections", intendedAccount: "acme" });
    const pending = await registry.attestCallback({ nonce, actorId: "owner", workspaceId: "a", installationId: "42", attestor });
    expect(registry.resolve("42", "acme/service")).toBeUndefined();
    registry.confirm(pending.installationId, "a");
    expect(registry.resolve("42", "acme/service")?.workspaceId).toBe("a");
    registry.revoke("42", "suspended");
    expect(registry.resolve("42", "acme/service")).toBeUndefined();
  });

  it("never lets an installation cross workspace boundaries", async () => {
    const registry = new GitHubInstallationRegistry();
    const first = registry.start({ actorId: "owner", workspaceId: "a", returnTo: "/", intendedAccount: "acme" });
    await registry.attestCallback({ nonce: first, actorId: "owner", workspaceId: "a", installationId: "42", attestor });
    const second = registry.start({ actorId: "owner", workspaceId: "b", returnTo: "/", intendedAccount: "acme" });
    await expect(registry.attestCallback({ nonce: second, actorId: "owner", workspaceId: "b", installationId: "42", attestor })).rejects.toThrow("another workspace");
  });
});
