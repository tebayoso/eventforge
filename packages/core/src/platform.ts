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
