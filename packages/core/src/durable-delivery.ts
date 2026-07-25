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
  "internal_error",
] as const;
export type SafeDeliveryReason = (typeof SafeDeliveryReason)[number];

export type DeliveryState =
  "accepted" | "queued" | "processing" | "retrying" | "completed" | "quarantined" | "rejected";
export type BillingEffect = "initial" | "none";

export function deliveryIdempotencyKey(workspaceId: string, deliveryId: string): string {
  return `delivery:${workspaceId}:${deliveryId}`;
}

function stableJitter(key: string): number {
  let hash = 2_166_136_261;
  for (const character of key) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return 0.75 + (hash >>> 0) / 0xffff_ffff / 2;
}

/** Bounded per-delivery jitter spreads recovery load while remaining replay-auditable. */
export function retryDelaySeconds(attempt: number, jitterKey = ""): number {
  const base = Math.min(300, 2 ** Math.max(0, attempt - 1));
  if (!jitterKey) return base;
  return Math.max(1, Math.min(300, Math.round(base * stableJitter(jitterKey))));
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
  jitterKey?: string;
}): { state: "retrying" | "quarantined"; reason: SafeDeliveryReason; delaySeconds?: number } {
  if (
    [
      "workspace_deleted",
      "validation_error",
      "payload_unavailable",
      "payload_corrupt",
      "payload_too_large",
      "internal_error",
    ].includes(input.reason)
  )
    return { state: "quarantined", reason: input.reason };
  if (!canProcessAttempt(input)) return { state: "quarantined", reason: "retry_exhausted" };
  return {
    state: "retrying",
    reason: input.reason,
    delaySeconds: retryDelaySeconds(input.attempts, input.jitterKey),
  };
}
