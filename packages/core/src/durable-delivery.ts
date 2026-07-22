/** Shared, payload-free delivery rules used by hosted adapters and operator tooling. */
export const DELIVERY_MAX_ATTEMPTS = 8;
export const DELIVERY_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const DELIVERY_LEASE_MS = 60_000;

export const SafeDeliveryReason = [
  "timeout",
  "validation_error",
  "upstream_unavailable",
  "rate_limited",
  "payload_unavailable",
  "payload_corrupt",
  "payload_too_large",
  "workspace_suspended",
  "workspace_deleted",
  "retry_exhausted",
  "reconciliation",
] as const;
export type SafeDeliveryReason = (typeof SafeDeliveryReason)[number];

export type DeliveryState =
  "accepted" | "queued" | "processing" | "retrying" | "completed" | "quarantined" | "rejected";
export type BillingEffect = "initial" | "none";

export function deliveryIdempotencyKey(workspaceId: string, deliveryId: string): string {
  return `delivery:${workspaceId}:${deliveryId}`;
}

/** Bounded deterministic exponential delay; no jitter makes operator replay auditable. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 2 ** Math.max(0, attempt - 1));
}

export function canProcessAttempt(input: {
  attempts: number;
  firstAttemptAt?: number;
  now: number;
}): boolean {
  return (
    input.attempts < DELIVERY_MAX_ATTEMPTS &&
    (input.firstAttemptAt === undefined ||
      input.now - input.firstAttemptAt <= DELIVERY_ATTEMPT_WINDOW_MS)
  );
}

export function retryState(input: {
  attempts: number;
  firstAttemptAt?: number;
  now: number;
  reason: SafeDeliveryReason;
}): { state: "retrying" | "quarantined"; reason: SafeDeliveryReason; delaySeconds?: number } {
  if (
    ["workspace_deleted", "validation_error", "payload_corrupt", "payload_too_large"].includes(
      input.reason,
    )
  )
    return { state: "quarantined", reason: input.reason };
  if (!canProcessAttempt(input)) return { state: "quarantined", reason: "retry_exhausted" };
  return {
    state: "retrying",
    reason: input.reason,
    delaySeconds: retryDelaySeconds(input.attempts),
  };
}
