import { z } from "zod";

/**
 * The only autonomous effect contemplated by the launch contract.  This is a
 * data boundary, not a provider implementation: no caller gets a write token
 * merely by producing one of these records.
 */
export const AutonomousLabelActionSchema = z.object({
  provider: z.literal("github"),
  actionClass: z.literal("github_workspace_informational_label"),
  operation: z.enum(["add", "remove"]),
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  repository: z.string().min(1),
  resourceId: z.string().min(1),
  labelId: z.string().min(1),
  labelClassification: z.literal("informational"),
  providerReadAfterWrite: z.literal(true),
  exactInverseSupported: z.literal(true),
});
export type AutonomousLabelAction = z.infer<typeof AutonomousLabelActionSchema>;

export const AutonomyGrantSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  repository: z.string().min(1),
  resourceIds: z.array(z.string().min(1)).min(1),
  actionClass: z.literal("github_workspace_informational_label"),
  labelIds: z.array(z.string().min(1)).min(1),
  policyDigest: z.string().min(32),
  policyVersion: z.number().int().positive(),
  riskTier: z.literal("low"),
  ownerId: z.string().min(1),
  ownerMfaAt: z.string().datetime(),
  securityApproverId: z.string().min(1),
  securityMfaAt: z.string().datetime(),
  shadowEvidenceDigest: z.string().min(32),
  budgets: z.object({
    workspacePerHour: z.number().int().positive().max(5),
    resourcePerHour: z.number().int().positive().max(1),
    workspacePerDay: z.number().int().positive().max(20),
    rollingSevenDays: z.number().int().positive().max(50),
    workspaceConcurrent: z.literal(1),
  }),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  verifier: z.object({ adapter: z.literal("github-read-after-write"), version: z.string().min(1) }),
  rollback: z.object({ exactInverse: z.literal(true), maxAttempts: z.literal(1) }),
  signatures: z.object({
    owner: z.string().min(32),
    security: z.string().min(32),
  }),
});
export type AutonomyGrant = z.infer<typeof AutonomyGrantSchema>;

export const ShadowEvidenceSchema = z.object({
  digest: z.string().min(32),
  distinctEligibleCases: z.number().int().nonnegative(),
  windowDays: z.number().int().nonnegative(),
  predictedObservedAgreements: z.number().int().nonnegative(),
  writesAttempted: z.number().int().nonnegative(),
  scopeViolations: z.number().int().nonnegative(),
  tenantViolations: z.number().int().nonnegative(),
  securityViolations: z.number().int().nonnegative(),
  unknownOrPartial: z.number().int().nonnegative(),
  rollbackDrillPassed: z.boolean(),
  killDrillPassed: z.boolean(),
  concurrencyDrillPassed: z.boolean(),
  fixtureOnly: z.boolean().default(false),
});
export type ShadowEvidence = z.infer<typeof ShadowEvidenceSchema>;

/**
 * Grants are routinely rehydrated from storage and handed to the evaluator as
 * already-typed objects, which makes every `z.literal` invariant above a
 * compile-time-only guarantee.  Re-parsing at the boundary is what actually
 * enforces `riskTier`, `rollback.exactInverse`, and the signature fields.
 */
const EvaluationInputSchema = z.object({
  action: AutonomousLabelActionSchema,
  grant: AutonomyGrantSchema,
  evidence: ShadowEvidenceSchema,
});

export type AutonomyEvaluation = {
  eligible: boolean;
  reasons: string[];
  wilsonLowerBound: number;
};

/**
 * Returns `NaN` for out-of-domain input rather than a misleading number.  The
 * caller must treat a non-finite bound as a denial: `successes > total` makes
 * `p * (1 - p)` negative, and an unguarded `NaN < 0.98` is `false`, which would
 * silently skip the statistical gate entirely.
 */
function wilsonLowerBound(successes: number, total: number): number {
  if (!Number.isFinite(successes) || !Number.isFinite(total)) return Number.NaN;
  if (total <= 0) return 0;
  if (successes < 0 || successes > total) return Number.NaN;
  const z95 = 1.959963984540054;
  const p = successes / total;
  return (
    (p + z95 ** 2 / (2 * total) - z95 * Math.sqrt((p * (1 - p) + z95 ** 2 / (4 * total)) / total)) /
    (1 + z95 ** 2 / total)
  );
}

/** Clock-skew allowance, matching the platform's existing 15-minute MFA recency convention. */
const MFA_SKEW_MS = 15 * 60_000;

/**
 * A grant outlives an interactive privileged action, so MFA recency is anchored
 * to the grant's own activation rather than to `now`: the approval must not be
 * in the future and must belong to this grant's window, not a prior one.
 */
function mfaBoundToGrant(mfaAt: string, startsAt: string, now: Date): boolean {
  const timestamp = Date.parse(mfaAt);
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now.getTime() &&
    timestamp >= Date.parse(startsAt) - MFA_SKEW_MS
  );
}

/** Fail closed unless an immutable, human-signed grant and real shadow evidence agree exactly. */
export function evaluateAutonomyEligibility(input: {
  action: AutonomousLabelAction;
  grant: AutonomyGrant;
  evidence: ShadowEvidence;
  currentPolicyDigest: string;
  currentPolicyVersion: number;
  now?: Date;
  invalidated?: boolean;
  budgetAvailable?: boolean;
  compositionAllowed?: boolean;
  controlPlaneFresh?: boolean;
}): AutonomyEvaluation {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  const parsed = EvaluationInputSchema.safeParse({
    action: input.action,
    grant: input.grant,
    evidence: input.evidence,
  });
  if (!parsed.success)
    return {
      eligible: false,
      reasons: ["Action, grant, or shadow evidence failed schema validation."],
      wilsonLowerBound: 0,
    };
  const { action, grant, evidence } = parsed.data;
  const lower = wilsonLowerBound(
    evidence.predictedObservedAgreements,
    evidence.distinctEligibleCases,
  );
  if (grant.ownerId === grant.securityApproverId)
    reasons.push("Owner and security approver must be distinct.");
  if (
    !mfaBoundToGrant(grant.ownerMfaAt, grant.startsAt, now) ||
    !mfaBoundToGrant(grant.securityMfaAt, grant.startsAt, now)
  )
    reasons.push("Owner or security MFA is stale, post-dated, or not bound to this grant.");
  if (Date.parse(grant.expiresAt) - Date.parse(grant.startsAt) > 7 * 24 * 60 * 60_000)
    reasons.push("Grant duration exceeds seven days.");
  if (now < new Date(grant.startsAt) || now >= new Date(grant.expiresAt))
    reasons.push("Grant is not active.");
  if (
    grant.policyDigest !== input.currentPolicyDigest ||
    grant.policyVersion !== input.currentPolicyVersion
  )
    reasons.push("Policy changed materially.");
  if (grant.shadowEvidenceDigest !== evidence.digest || evidence.fixtureOnly)
    reasons.push("Current customer shadow evidence is required.");
  if (evidence.distinctEligibleCases < 200 || evidence.windowDays < 14)
    reasons.push("Insufficient shadow cases or duration.");
  if (!Number.isFinite(lower))
    reasons.push("Shadow evidence is internally inconsistent or out of domain.");
  else if (
    evidence.predictedObservedAgreements / Math.max(1, evidence.distinctEligibleCases) < 0.99 ||
    lower < 0.98
  )
    reasons.push("Shadow prediction agreement is below the statistical gate.");
  if (
    evidence.writesAttempted ||
    evidence.scopeViolations ||
    evidence.tenantViolations ||
    evidence.securityViolations ||
    evidence.unknownOrPartial
  )
    reasons.push("Shadow evidence contains a disqualifying result.");
  if (
    !evidence.rollbackDrillPassed ||
    !evidence.killDrillPassed ||
    !evidence.concurrencyDrillPassed
  )
    reasons.push("Required containment drills have not passed.");
  if (
    action.workspaceId !== grant.workspaceId ||
    action.installationId !== grant.installationId ||
    action.repository !== grant.repository ||
    !grant.resourceIds.includes(action.resourceId) ||
    !grant.labelIds.includes(action.labelId)
  )
    reasons.push("Action scope does not exactly match the grant.");
  if (
    input.invalidated ||
    !input.budgetAvailable ||
    !input.compositionAllowed ||
    !input.controlPlaneFresh
  )
    reasons.push("Autonomy authority, budget, composition, or control-plane check failed.");
  return { eligible: reasons.length === 0, reasons, wilsonLowerBound: lower };
}
