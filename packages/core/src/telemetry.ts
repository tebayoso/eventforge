import { createHmac, createHash, randomBytes } from "node:crypto";

export const TELEMETRY_SCHEMA_VERSION = "1.0.0";
export const LIFECYCLE_STAGES = ["event.receive", "event.verify", "delivery.persist", "investigation.run", "tool.category", "policy.evaluate", "approval.wait", "reaction.attempt", "outcome.record"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export const TELEMETRY_ATTRIBUTES = ["schema_version", "stage", "status", "source_category", "tool_category", "policy_result", "approval_state", "reaction_type", "outcome", "retry_count_bucket", "sampled", "drop_reason", "duration_bucket", "queue_latency_bucket", "timestamp", "workspace_pseudonym"] as const;
export type TelemetryAttribute = (typeof TELEMETRY_ATTRIBUTES)[number];

export type SafeLifecycleInput = {
  stage: LifecycleStage;
  status: "ok" | "failed" | "pending" | "suppressed";
  traceId: string;
  parentSpanId?: string;
  sourceCategory?: "github" | "linear" | "sentry" | "custom";
  toolCategory?: "read" | "write" | "network" | "none";
  policyResult?: "allowed" | "denied" | "approval_required";
  approvalState?: "waiting" | "approved" | "rejected" | "none";
  reactionType?: "comment" | "create_branch" | "open_pull_request" | "none";
  outcome?: "completed" | "failed" | "skipped" | "none";
  retryCount?: number;
  durationMs?: number;
  queueLatencyMs?: number;
  timestamp?: string;
};

const bucket = (value?: number) => value === undefined ? undefined : value < 100 ? "lt_100ms" : value < 1000 ? "lt_1s" : value < 10_000 ? "lt_10s" : "gte_10s";
const retryBucket = (value = 0) => value === 0 ? "0" : value === 1 ? "1" : value <= 3 ? "2_3" : "4_5";

export function workspacePseudonym(workspaceId: string, destinationSecret: string, version = "v1"): string {
  if (!workspaceId || !destinationSecret) throw new Error("workspace and destination secret are required");
  return `${version}:${createHmac("sha256", destinationSecret).update(workspaceId).digest("hex").slice(0, 32)}`;
}

export function deterministicSample(traceId: string, percent = 10): boolean {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("sampling percent must be 0-100");
  return createHash("sha256").update(traceId).digest().readUInt32BE(0) % 100 < percent;
}

export function projectSafeSpan(input: SafeLifecycleInput, workspaceId: string, destinationSecret: string) {
  if (!LIFECYCLE_STAGES.includes(input.stage)) throw new Error("unknown lifecycle stage");
  const attributes: Partial<Record<TelemetryAttribute, string | boolean>> = {
    schema_version: TELEMETRY_SCHEMA_VERSION, stage: input.stage, status: input.status,
    sampled: true, timestamp: input.timestamp ?? new Date().toISOString(),
    workspace_pseudonym: workspacePseudonym(workspaceId, destinationSecret), retry_count_bucket: retryBucket(input.retryCount),
  };
  const optional = {
    source_category: input.sourceCategory, tool_category: input.toolCategory, policy_result: input.policyResult,
    approval_state: input.approvalState, reaction_type: input.reactionType, outcome: input.outcome,
    duration_bucket: bucket(input.durationMs), queue_latency_bucket: bucket(input.queueLatencyMs),
  } as const;
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) attributes[key as TelemetryAttribute] = value;
  return { traceId: input.traceId, spanId: randomBytes(8).toString("hex"), parentSpanId: input.parentSpanId, name: input.stage, attributes };
}

export function validateOtlpHttpEndpoint(value: string, localDevelopment = false): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || (!localDevelopment && (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "::1"))) throw new Error("OTLP endpoint is not permitted");
  if (![443, 4318].includes(Number(endpoint.port || 443))) throw new Error("OTLP port is not permitted");
  return endpoint;
}
