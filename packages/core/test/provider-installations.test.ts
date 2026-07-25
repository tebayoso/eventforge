import { describe, expect, it } from "vitest";
import {
  LinearReactionRequestSchema,
  ProviderInstallationSchema,
  isProviderInstallationUsable,
  type ProviderInstallation,
} from "../src/provider-installations.js";

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

  // A throw while evaluating this module aborts collection for every suite that
  // reaches it through the barrel, so the run reports "no tests" instead of a
  // failed assertion. Importing the barrel must therefore stay side-effect safe.
  it("builds every contract at module load so barrel importers still collect tests", async () => {
    const barrel = await import("../src/index.js");
    expect(barrel.providerInstallations.ProviderInstallationSchema).toBeDefined();
    expect(barrel.providerInstallations.LinearReactionRequestSchema).toBeDefined();
  });

  // The reaction contract narrows the installation to a healthy, reaction-enabled
  // Linear install. Those literals only exist if the base object schema was
  // extended successfully, so this also pins the module-load fix above.
  it("refuses reactions from installations that are not healthy Linear reaction installs", () => {
    const reaction = (overrides: Record<string, unknown>) =>
      LinearReactionRequestSchema.safeParse({
        installation: { ...installation, ...overrides },
        issueId: "issue-a",
        action: { kind: "add_comment", comment: "hello" },
      });
    expect(reaction({ state: "revoked" }).success).toBe(false);
    expect(reaction({ state: "expired" }).success).toBe(false);
    expect(reaction({ mode: "read_only" }).success).toBe(false);
    expect(reaction({ provider: "sentry" }).success).toBe(false);
    expect(reaction({}).success).toBe(true);
  });

  it("treats every state other than healthy as unusable", () => {
    const states = [
      "pending",
      "degraded",
      "expired",
      "revoked",
      "misconfigured",
      "disconnected",
    ] as const;
    for (const state of states)
      expect(isProviderInstallationUsable({ ...installation, state } as ProviderInstallation)).toBe(
        false,
      );
    expect(isProviderInstallationUsable(ProviderInstallationSchema.parse(installation))).toBe(true);
  });
});
