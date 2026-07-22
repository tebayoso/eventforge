import { z } from "zod";

const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Scope = z.object({ workspaceId: z.string().min(1), projectId: z.string().min(1) });

export const EndpointSchema = Scope.extend({
  id: Id,
  environmentId: Id,
  name: z.string().min(1),
  url: z.string().url(),
  status: z.enum(["active", "paused", "quarantined"]),
  signingSecretVersion: z.number().int().positive(),
  createdAt: Timestamp,
});
export type Endpoint = z.infer<typeof EndpointSchema>;

export const RouteSchema = Scope.extend({
  id: Id,
  environmentId: Id,
  source: z.string().min(1),
  endpointIds: z.array(Id).min(1),
  enabled: z.boolean(),
  filter: z.record(z.unknown()).default({}),
  transform: z.record(z.unknown()).optional(),
  createdAt: Timestamp,
});
export type Route = z.infer<typeof RouteSchema>;

export const DeliveryAttemptSchema = z.object({
  id: Id,
  deliveryId: Id,
  attempt: z.number().int().positive(),
  status: z.enum(["pending", "delivered", "retrying", "failed", "dead_letter"]),
  responseCode: z.number().int().min(100).max(599).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  startedAt: Timestamp,
  finishedAt: Timestamp.optional(),
});
export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

export const DeliverySchema = Scope.extend({
  id: Id,
  eventId: Id,
  routeId: Id,
  endpointId: Id,
  idempotencyKey: z.string().min(1),
  status: z.enum(["pending", "delivered", "retrying", "failed", "dead_letter", "cancelled"]),
  billable: z.boolean().default(true),
  createdAt: Timestamp,
  completedAt: Timestamp.optional(),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const DeliveryCreateSchema = DeliverySchema.omit({ billable: true });
export type DeliveryCreate = z.infer<typeof DeliveryCreateSchema>;

export const ReplayPreviewSchema = Scope.extend({
  eventCount: z.number().int().nonnegative(),
  destinationCount: z.number().int().nonnegative(),
  estimatedBillableDeliveries: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  canarySize: z.number().int().nonnegative(),
});
export type ReplayPreview = z.infer<typeof ReplayPreviewSchema>;

export const UsageSummarySchema = z.object({
  workspaceId: z.string().min(1),
  meter: z.enum(["delivered_event", "smart_reaction"]),
  included: z.number().int().nonnegative(),
  consumed: z.number().int().nonnegative(),
  forecast: z.number().int().nonnegative(),
  warningThreshold: z.number().int().nonnegative(),
  hardCap: z.number().int().nonnegative().optional(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const IssueSchema = Scope.extend({
  id: Id,
  fingerprint: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["open", "acknowledged", "resolved"]),
  severity: z.enum(["info", "warning", "critical"]),
  firstSeenAt: Timestamp,
  lastSeenAt: Timestamp,
  occurrenceCount: z.number().int().positive(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const AlertPolicySchema = Scope.extend({
  id: Id,
  name: z.string().min(1),
  enabled: z.boolean(),
  destinations: z.array(z.enum(["email", "slack", "webhook", "pagerduty", "teams"])),
  conditions: z.record(z.unknown()),
  createdAt: Timestamp,
});
export type AlertPolicy = z.infer<typeof AlertPolicySchema>;

export const IncidentSchema = Scope.extend({
  id: Id,
  issueIds: z.array(Id),
  status: z.enum(["investigating", "mitigating", "resolved"]),
  startedAt: Timestamp,
  resolvedAt: Timestamp.optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

const CorrelationWindowSchema = z.object({
  repositoryRevisionMinutes: z.number().int().min(5).max(24 * 60),
  deploymentMinutes: z.number().int().min(5).max(2 * 60),
  fingerprintMinutes: z.number().int().min(5).max(30),
  providerLinkMinutes: z.number().int().min(5).max(24 * 60),
});
export const CorrelationConfigSchema = Scope.extend({
  version: z.number().int().positive(),
  effectiveAt: Timestamp,
  windows: CorrelationWindowSchema,
});
export type CorrelationConfig = z.infer<typeof CorrelationConfigSchema>;

export const CorrelationEventSchema = Scope.extend({
  id: Id,
  occurredAt: Timestamp,
  canonicalIdentity: z.string().min(1),
  repositoryId: z.string().min(1).optional(),
  revision: z.string().min(1).optional(),
  deploymentId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
  issueFingerprint: z.string().min(1).optional(),
  providerLink: z.string().min(1).optional(),
});
export type CorrelationEvent = z.infer<typeof CorrelationEventSchema>;

export const CorrelationMembershipSchema = Scope.extend({
  id: Id,
  incidentId: Id,
  eventId: Id,
  causalEventId: Id,
  matchedSignals: z
    .array(
      z.enum([
        "repository_revision",
        "deployment",
        "service_environment_fingerprint",
        "provider_link",
      ]),
    )
    .min(1),
  ruleVersion: z.number().int().positive(),
  configVersion: z.number().int().positive(),
  windowMinutes: z.number().int().positive(),
  mode: z.enum(["automatic", "manual"]),
  reason: z.string().min(1),
  outcome: z.enum(["proposed", "accepted", "superseded", "ungrouped"]),
  createdAt: Timestamp,
});
export type CorrelationMembership = z.infer<typeof CorrelationMembershipSchema>;

export type CorrelationDecision =
  | { outcome: "proposed"; candidateEventId: string; matchedSignals: string[]; windowMinutes: number; reason: string }
  | { outcome: "ungrouped"; reason: "insufficient_signals" | "ambiguous_candidates" | "outside_window" };
type CorrelationSignal =
  | "repository_revision"
  | "deployment"
  | "service_environment_fingerprint"
  | "provider_link";

/** Pure, versioned evaluation over immutable normalized snapshots. */
export function evaluateCorrelation(
  event: CorrelationEvent,
  candidates: readonly CorrelationEvent[],
  config: CorrelationConfig,
): CorrelationDecision {
  const scopedCandidates = candidates.filter(
    (candidate) => candidate.workspaceId === event.workspaceId && candidate.projectId === event.projectId,
  );
  const matches = scopedCandidates
    .flatMap((candidate) => {
      const minutes = Math.abs(Date.parse(event.occurredAt) - Date.parse(candidate.occurredAt)) / 60_000;
      const signal: readonly [CorrelationSignal, number] | undefined =
        event.providerLink && event.providerLink === candidate.providerLink
          ? ["provider_link", config.windows.providerLinkMinutes]
          : event.deploymentId && event.deploymentId === candidate.deploymentId
            ? ["deployment", config.windows.deploymentMinutes]
            : event.repositoryId &&
                event.repositoryId === candidate.repositoryId &&
                event.revision &&
                event.revision === candidate.revision
              ? ["repository_revision", config.windows.repositoryRevisionMinutes]
              : event.serviceId &&
                  event.serviceId === candidate.serviceId &&
                  event.environmentId &&
                  event.environmentId === candidate.environmentId &&
                  event.issueFingerprint &&
                  event.issueFingerprint === candidate.issueFingerprint
                ? ["service_environment_fingerprint", config.windows.fingerprintMinutes]
                : undefined;
      return signal && minutes <= signal[1] ? [{ candidate, signal: signal[0], window: signal[1] }] : [];
    });
  if (!matches.length)
    return { outcome: "ungrouped", reason: scopedCandidates.length ? "outside_window" : "insufficient_signals" };
  const unique = new Set(matches.map((match) => match.candidate.id));
  if (unique.size !== 1) return { outcome: "ungrouped", reason: "ambiguous_candidates" };
  const match = matches.sort((a, b) => a.candidate.id.localeCompare(b.candidate.id))[0];
  return {
    outcome: "proposed",
    candidateEventId: match.candidate.id,
    matchedSignals: [match.signal],
    windowMinutes: match.window,
    reason: `matched_${match.signal}`,
  };
}

export const ReactionPolicySchema = Scope.extend({
  id: Id,
  version: z.number().int().positive(),
  action: z.enum([
    "pause_route",
    "quarantine_route",
    "reduce_concurrency",
    "open_circuit",
    "replay_canary",
    "suppress_source",
    "rotate_secret",
  ]),
  approvalMode: z.enum(["approval_required", "preapproved_bounded"]),
  maxTargets: z.number().int().positive(),
  maxCostUsd: z.number().nonnegative(),
  timeoutSeconds: z.number().int().positive(),
  createdAt: Timestamp,
});
export type ReactionPolicy = z.infer<typeof ReactionPolicySchema>;

export const ReactionRunSchema = Scope.extend({
  id: Id,
  policyId: Id,
  incidentId: Id,
  idempotencyKey: z.string().min(1),
  status: z.enum([
    "proposed",
    "approved",
    "running",
    "verifying",
    "succeeded",
    "failed",
    "rolled_back",
  ]),
  actualCostUsd: z.number().nonnegative().default(0),
  createdAt: Timestamp,
  finishedAt: Timestamp.optional(),
});
export type ReactionRun = z.infer<typeof ReactionRunSchema>;

export const EvidenceBundleSchema = Scope.extend({
  id: Id,
  incidentId: Id,
  eventIds: z.array(Id),
  deliveryIds: z.array(Id),
  reactionRunIds: z.array(Id),
  payloadRef: z.string().optional(),
  createdAt: Timestamp,
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

export const UsageRecordSchema = Scope.extend({
  id: Id,
  idempotencyKey: z.string().min(1),
  meter: z.enum(["delivered_event", "smart_reaction"]),
  quantity: z.number().int().positive(),
  occurredAt: Timestamp,
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

export const EntitlementSchema = z.object({
  workspaceId: z.string().min(1),
  plan: z.enum(["developer", "team", "pro", "business", "enterprise"]),
  deliveredEventsIncluded: z.number().int().nonnegative(),
  smartReactionsIncluded: z.number().int().nonnegative(),
  hardSpendCapUsd: z.number().nonnegative().optional(),
  effectiveAt: Timestamp,
});
export type Entitlement = z.infer<typeof EntitlementSchema>;
