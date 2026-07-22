export const OUTCOME_METRIC_VERSION = "outcome-metrics/v1";

export const OutcomeStates = [
  "proposed", "approved", "rejected", "expired", "executed", "effect-verified",
  "effect-failed", "rolled-back", "resolution-verified", "recurrence", "unknown", "excluded",
] as const;
export type OutcomeState = (typeof OutcomeStates)[number];
export type EvidenceMethod = "provider_measurement" | "provider_recovery" | "no_recurrence_window" | "manual_attestation" | "unavailable";

export type OutcomeTransition = {
  id: string;
  workspaceId: string;
  subjectId: string;
  state: OutcomeState;
  occurredAt: string;
  evidence: { method: EvidenceMethod; source: string; version: string; observedAt: string; actorRole?: string };
  attributionId?: string;
};

export type OutcomeMetrics = {
  version: string;
  sourceCutoff: string;
  effectVerificationRate?: number;
  resolutionRate?: number;
  rollbackRate?: number;
  unknownRate?: number;
  unknownCount: number;
  excludedCount: number;
  completeness: { numerator: number; denominator: number; rate: number; comparisonEnabled: boolean };
  freshnessMs: number;
};

const independentResolution = new Set<EvidenceMethod>([
  "provider_recovery", "no_recurrence_window", "manual_attestation",
]);

export function projectOutcomeMetrics(
  workspaceId: string,
  transitions: readonly OutcomeTransition[],
  now = new Date(),
): OutcomeMetrics {
  const latest = new Map<string, OutcomeTransition>();
  for (const transition of transitions) {
    if (transition.workspaceId !== workspaceId) continue;
    const prior = latest.get(transition.subjectId);
    if (!prior || Date.parse(transition.occurredAt) >= Date.parse(prior.occurredAt)) latest.set(transition.subjectId, transition);
  }
  const values = [...latest.values()];
  const count = (state: OutcomeState) => values.filter((item) => item.state === state).length;
  const attempted = values.filter((item) => ["executed", "effect-verified", "effect-failed", "rolled-back", "unknown"].includes(item.state)).length;
  const eligibleResolution = values.filter((item) => independentResolution.has(item.evidence.method)).length;
  const verificationsRequired = values.filter((item) => !["proposed", "approved", "rejected", "expired", "excluded"].includes(item.state)).length;
  const cutoff = values.reduce((latestAt, item) => (item.occurredAt > latestAt ? item.occurredAt : latestAt), "");
  const numerator = values.filter((item) => item.evidence.method !== "unavailable").length;
  const denominator = values.filter((item) => item.state !== "excluded").length;
  return {
    version: OUTCOME_METRIC_VERSION,
    sourceCutoff: cutoff,
    effectVerificationRate: attempted ? count("effect-verified") / attempted : undefined,
    resolutionRate: eligibleResolution ? count("resolution-verified") / eligibleResolution : undefined,
    rollbackRate: attempted ? count("rolled-back") / attempted : undefined,
    unknownRate: verificationsRequired ? count("unknown") / verificationsRequired : undefined,
    unknownCount: count("unknown"),
    excludedCount: count("excluded"),
    completeness: { numerator, denominator, rate: denominator ? numerator / denominator : 1, comparisonEnabled: denominator ? numerator / denominator >= 0.8 : true },
    freshnessMs: cutoff ? Math.max(0, now.getTime() - Date.parse(cutoff)) : Number.POSITIVE_INFINITY,
  };
}

export function unknownAging(transition: OutcomeTransition, now = new Date()): "none" | "warning" | "escalation" {
  if (transition.state !== "unknown") return "none";
  const age = now.getTime() - Date.parse(transition.occurredAt);
  return age >= 48 * 60 * 60 * 1000 ? "escalation" : age >= 24 * 60 * 60 * 1000 ? "warning" : "none";
}
