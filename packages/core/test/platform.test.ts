import { describe, expect, it } from "vitest";
import {
  DeliverySchema,
  EntitlementSchema,
  ReactionPolicySchema,
  UsageRecordSchema,
} from "../src/index.js";

describe("commercial platform contracts", () => {
  it("makes only the initial destination delivery billable", () => {
    const delivery = DeliverySchema.parse({
      id: crypto.randomUUID(),
      workspaceId: "w",
      projectId: "p",
      eventId: crypto.randomUUID(),
      routeId: crypto.randomUUID(),
      endpointId: crypto.randomUUID(),
      idempotencyKey: "event:route:endpoint",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(delivery.billable).toBe(true);
  });

  it("rejects usage without an idempotency key", () => {
    expect(() =>
      UsageRecordSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: "w",
        projectId: "p",
        meter: "delivered_event",
        quantity: 1,
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("requires bounded reaction policies", () => {
    expect(() =>
      ReactionPolicySchema.parse({
        id: crypto.randomUUID(),
        workspaceId: "w",
        projectId: "p",
        version: 1,
        action: "pause_route",
        approvalMode: "preapproved_bounded",
        maxTargets: 0,
        maxCostUsd: 1,
        timeoutSeconds: 30,
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("encodes the developer allowance", () => {
    const entitlement = EntitlementSchema.parse({
      workspaceId: "w",
      plan: "developer",
      deliveredEventsIncluded: 25_000,
      smartReactionsIncluded: 0,
      effectiveAt: new Date().toISOString(),
    });
    expect(entitlement.deliveredEventsIncluded).toBe(25_000);
  });
});
