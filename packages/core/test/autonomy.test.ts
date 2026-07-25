import { describe, expect, it } from "vitest";
import {
  evaluateAutonomyEligibility,
  type AutonomousLabelAction,
  type AutonomyGrant,
  type ShadowEvidence,
} from "../src/autonomy.js";

const digest = "a".repeat(64);
const now = new Date("2026-07-22T12:00:00.000Z");
const action: AutonomousLabelAction = {
  provider: "github",
  actionClass: "github_workspace_informational_label",
  operation: "add",
  workspaceId: "w",
  installationId: "i",
  repository: "o/r",
  resourceId: "issue-1",
  labelId: "label-1",
  labelClassification: "informational",
  providerReadAfterWrite: true,
  exactInverseSupported: true,
};
const grant: AutonomyGrant = {
  id: "00000000-0000-4000-8000-000000000011",
  version: 1,
  workspaceId: "w",
  installationId: "i",
  repository: "o/r",
  resourceIds: ["issue-1"],
  actionClass: "github_workspace_informational_label",
  labelIds: ["label-1"],
  policyDigest: digest,
  policyVersion: 3,
  riskTier: "low",
  ownerId: "owner",
  ownerMfaAt: "2026-07-22T11:00:00.000Z",
  securityApproverId: "security",
  securityMfaAt: "2026-07-22T11:00:00.000Z",
  shadowEvidenceDigest: digest,
  budgets: {
    workspacePerHour: 5,
    resourcePerHour: 1,
    workspacePerDay: 20,
    rollingSevenDays: 50,
    workspaceConcurrent: 1,
  },
  startsAt: "2026-07-22T00:00:00.000Z",
  expiresAt: "2026-07-29T00:00:00.000Z",
  verifier: { adapter: "github-read-after-write", version: "1" },
  rollback: { exactInverse: true, maxAttempts: 1 },
  signatures: { owner: digest, security: digest },
};
const evidence: ShadowEvidence = {
  digest,
  distinctEligibleCases: 400,
  windowDays: 14,
  predictedObservedAgreements: 400,
  writesAttempted: 0,
  scopeViolations: 0,
  tenantViolations: 0,
  securityViolations: 0,
  unknownOrPartial: 0,
  rollbackDrillPassed: true,
  killDrillPassed: true,
  concurrencyDrillPassed: true,
  fixtureOnly: false,
};
const evaluate = (patch: Partial<Parameters<typeof evaluateAutonomyEligibility>[0]> = {}) =>
  evaluateAutonomyEligibility({
    action,
    grant,
    evidence,
    currentPolicyDigest: digest,
    currentPolicyVersion: 3,
    now,
    budgetAvailable: true,
    compositionAllowed: true,
    controlPlaneFresh: true,
    ...patch,
  });

describe("graduated autonomy gate", () => {
  it("allows only fully evidenced, exact low-risk label grants", () =>
    expect(evaluate().eligible).toBe(true));
  it("fails closed for policy/evidence/budget/composition/control invalidation", () => {
    for (const patch of [
      { currentPolicyVersion: 4 },
      { evidence: { ...evidence, fixtureOnly: true } },
      { budgetAvailable: false },
      { compositionAllowed: false },
      { controlPlaneFresh: false },
      { invalidated: true },
    ])
      expect(evaluate(patch)).toMatchObject({ eligible: false });
  });
  it("rejects grant stacking, expiry cycling, and insufficient statistical evidence", () => {
    expect(evaluate({ action: { ...action, labelId: "label-2" } })).toMatchObject({
      eligible: false,
    });
    expect(evaluate({ grant: { ...grant, expiresAt: "2026-07-30T00:00:00.000Z" } })).toMatchObject({
      eligible: false,
    });
    expect(
      evaluate({
        evidence: { ...evidence, distinctEligibleCases: 200, predictedObservedAgreements: 198 },
      }),
    ).toMatchObject({ eligible: false });
  });
  it("fails closed when agreements exceed eligible cases instead of passing on a NaN bound", () => {
    // Regression: p > 1 makes p*(1-p) negative, so the Wilson bound went NaN and
    // `NaN < 0.98` is false, which silently skipped the whole statistical gate.
    const result = evaluate({
      evidence: { ...evidence, distinctEligibleCases: 200, predictedObservedAgreements: 100000 },
    });
    expect(result.eligible).toBe(false);
    expect(Number.isFinite(result.wilsonLowerBound)).toBe(false);
    expect(result.reasons).toContain(
      "Shadow evidence is internally inconsistent or out of domain.",
    );
  });

  it("fails closed for non-finite and negative shadow counts", () => {
    for (const evidencePatch of [
      { predictedObservedAgreements: Number.NaN },
      { predictedObservedAgreements: Number.POSITIVE_INFINITY },
      { distinctEligibleCases: Number.POSITIVE_INFINITY },
      { distinctEligibleCases: Number.NaN },
      { predictedObservedAgreements: -1 },
    ])
      expect(evaluate({ evidence: { ...evidence, ...evidencePatch } })).toMatchObject({
        eligible: false,
      });
  });

  it("denies stale, post-dated, and unparseable MFA timestamps", () => {
    for (const grantPatch of [
      { ownerMfaAt: "2020-01-01T00:00:00.000Z" },
      { securityMfaAt: "2020-01-01T00:00:00.000Z" },
      // After `now`: an approval cannot have happened in the future.
      { ownerMfaAt: "2026-07-28T00:00:00.000Z" },
      // Before this grant's own window: carried over from a prior grant.
      { securityMfaAt: "2026-07-21T00:00:00.000Z" },
      { ownerMfaAt: "not-a-timestamp" },
    ])
      expect(evaluate({ grant: { ...grant, ...grantPatch } })).toMatchObject({ eligible: false });
  });

  it("rejects hydrated grants whose runtime invariants violate the schema", () => {
    // These are `z.literal` fields, so TypeScript alone cannot protect a grant
    // rehydrated from storage; only the boundary parse rejects them.
    for (const grantPatch of [
      { riskTier: "high" },
      { rollback: { exactInverse: false, maxAttempts: 1 } },
      { rollback: { exactInverse: true, maxAttempts: 3 } },
      { signatures: { owner: "short", security: digest } },
      { verifier: { adapter: "attacker-supplied", version: "1" } },
      { budgets: { ...grant.budgets, workspacePerHour: 500 } },
      { id: "not-a-uuid" },
    ])
      expect(
        evaluate({ grant: { ...grant, ...grantPatch } as unknown as AutonomyGrant }),
      ).toMatchObject({
        eligible: false,
        reasons: ["Action, grant, or shadow evidence failed schema validation."],
      });
  });

  it("rejects a hydrated action whose classification invariants violate the schema", () => {
    for (const actionPatch of [
      { labelClassification: "destructive" },
      { providerReadAfterWrite: false },
      { exactInverseSupported: false },
    ])
      expect(
        evaluate({ action: { ...action, ...actionPatch } as unknown as AutonomousLabelAction }),
      ).toMatchObject({
        eligible: false,
        reasons: ["Action, grant, or shadow evidence failed schema validation."],
      });
  });

  it("disqualifies shadow writes, unknown outcomes, violations, and failed containment drills", () => {
    for (const evidencePatch of [
      { writesAttempted: 1 },
      { unknownOrPartial: 1 },
      { tenantViolations: 1 },
      { rollbackDrillPassed: false },
    ])
      expect(evaluate({ evidence: { ...evidence, ...evidencePatch } })).toMatchObject({
        eligible: false,
      });
  });
});
