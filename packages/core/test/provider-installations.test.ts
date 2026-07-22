import { describe, expect, it } from "vitest";
import { LinearReactionRequestSchema, ProviderInstallationSchema } from "../src/index.js";

const installation = {
  id: crypto.randomUUID(),
  provider: "linear",
  workspaceId: "workspace-a",
  providerAccountId: "org-a",
  installationKey: "org-a",
  mode: "reaction_enabled",
  resources: { mode: "selective", resourceIds: ["team-a"], confirmedAt: new Date().toISOString() },
  state: "healthy",
  scopeVersion: 1,
};

describe("provider installation contracts", () => {
  it("requires explicit resource confirmation and rejects Sentry writes", () => {
    expect(() => ProviderInstallationSchema.parse({ ...installation, provider: "sentry" })).toThrow(
      "read-only",
    );
    expect(() =>
      ProviderInstallationSchema.parse({
        ...installation,
        resources: { ...installation.resources, resourceIds: [] },
      }),
    ).toThrow();
  });

  it("permits only the bounded Linear reaction allowlist", () => {
    expect(
      LinearReactionRequestSchema.parse({
        installation,
        issueId: "issue-a",
        action: { kind: "transition", stateId: "done" },
        allowedStateIds: ["done"],
      }).action.kind,
    ).toBe("transition");
    expect(() =>
      LinearReactionRequestSchema.parse({
        installation,
        issueId: "issue-a",
        action: { kind: "transition", stateId: "admin" },
        allowedStateIds: ["done"],
      }),
    ).toThrow("allowlisted");
    expect(() =>
      LinearReactionRequestSchema.parse({
        installation,
        issueId: "issue-a",
        action: { kind: "delete_issue" },
      }),
    ).toThrow();
  });
});
