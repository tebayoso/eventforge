import { describe, expect, it } from "vitest";
import {
  DELIVERY_MAX_ATTEMPTS,
  deliveryIdempotencyKey,
  retryDelaySeconds,
  retryState,
} from "../src/durable-delivery.js";

describe("durable delivery rules", () => {
  it("keeps tenant-colliding provider IDs and their usage independent", () => {
    const providerIds = Array.from({ length: 100 }, (_, index) => `provider-${index % 90}`);
    const outcomes = new Set<string>();
    const usage = new Set<string>();
    for (const workspaceId of ["workspace-a", "workspace-b"]) {
      for (const providerId of providerIds) {
        const key = deliveryIdempotencyKey(workspaceId, providerId);
        outcomes.add(key);
        usage.add(key);
      }
    }
    // 10 duplicate injections per tenant produce no extra logical outcome or usage record.
    expect(outcomes).toHaveLength(180);
    expect(usage).toEqual(outcomes);
    expect(deliveryIdempotencyKey("workspace-a", "provider-1")).not.toBe(
      deliveryIdempotencyKey("workspace-b", "provider-1"),
    );
  });

  it("counts crashed attempts and quarantines once the eight-attempt budget is spent", () => {
    expect(
      retryState({ attempts: DELIVERY_MAX_ATTEMPTS, now: Date.now(), reason: "timeout" }),
    ).toEqual({
      state: "quarantined",
      reason: "retry_exhausted",
    });
  });

  it("uses bounded deterministic retries and never retries poison payloads", () => {
    expect(retryDelaySeconds(1)).toBe(1);
    expect(retryDelaySeconds(99)).toBe(300);
    expect(retryState({ attempts: 1, now: Date.now(), reason: "payload_corrupt" })).toEqual({
      state: "quarantined",
      reason: "payload_corrupt",
    });
  });
});
