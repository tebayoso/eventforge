import { describe, expect, it } from "vitest";
import {
  AuditStreamEventSchema,
  authorizeEnterpriseScope,
  BreakGlassGrantSchema,
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

  it("uses only the authenticated server enterprise scope", () => {
    const enterpriseOrgId = crypto.randomUUID();
    expect(() => authorizeEnterpriseScope({ enterpriseOrgId, workspaceId: "w", actorId: "a", roles: ["identity_admin"] }, { enterpriseOrgId })).toThrow();
    expect(authorizeEnterpriseScope({ enterpriseOrgId, workspaceId: "w", actorId: "a", roles: ["identity_admin"] }, { workspaceId: "w" })).toEqual({ enterpriseOrgId, workspaceId: "w" });
  });

  it("requires distinct custodians and bounded break-glass", () => {
    const createdAt = new Date().toISOString();
    expect(() => BreakGlassGrantSchema.parse({ id: crypto.randomUUID(), enterpriseOrgId: crypto.randomUUID(), trigger: "idp_outage", custodianIds: ["same", "same"], scope: "identity_recovery", createdAt, expiresAt: new Date(Date.now() + 61 * 60_000).toISOString() })).toThrow();
  });

  it("requires ordered per-workspace enterprise audit events", () => {
    expect(() => AuditStreamEventSchema.parse({ id: crypto.randomUUID(), enterpriseOrgId: crypto.randomUUID(), workspaceId: "w", sequence: 0, eventType: "hold_released", actorId: "a", authMethod: "passkey", targetHash: "hash", result: "success", previousHash: "hash", createdAt: new Date().toISOString() })).toThrow();
  });
});
