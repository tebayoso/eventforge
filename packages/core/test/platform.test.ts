import { describe, expect, it } from "vitest";
import {
  AuditStreamEventSchema,
  authorizeEnterpriseScope,
  BreakGlassGrantSchema,
  DeliverySchema,
  EntitlementSchema,
  type EnterpriseServerScope,
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
    expect(() =>
      authorizeEnterpriseScope(
        { enterpriseOrgId, workspaceId: "w", actorId: "a", roles: ["identity_admin"] },
        { enterpriseOrgId },
      ),
    ).toThrow();
    expect(
      authorizeEnterpriseScope(
        { enterpriseOrgId, workspaceId: "w", actorId: "a", roles: ["identity_admin"] },
        { workspaceId: "w" },
      ),
    ).toEqual({ enterpriseOrgId, workspaceId: "w" });
  });

  it("rejects a payload workspace outside the authenticated scope", () => {
    const serverScope: EnterpriseServerScope = {
      enterpriseOrgId: crypto.randomUUID(),
      workspaceId: "w",
      actorId: "a",
      roles: ["identity_admin"],
    };
    expect(() => authorizeEnterpriseScope(serverScope, { workspaceId: "other" })).toThrow(
      /workspace is not authorized/,
    );
    // An org-level actor holds no workspace, so it cannot borrow one from the payload.
    expect(() =>
      authorizeEnterpriseScope({ ...serverScope, workspaceId: undefined }, { workspaceId: "w" }),
    ).toThrow(/workspace is not authorized/);
  });

  it("rejects an enterprise server scope that is not itself authenticated", () => {
    const payload = { workspaceId: "w" };
    // Role-less actor context: no enterprise role means no authorized scope.
    expect(() =>
      authorizeEnterpriseScope(
        { enterpriseOrgId: crypto.randomUUID(), workspaceId: "w", actorId: "a", roles: [] },
        payload,
      ),
    ).toThrow();
    // Missing tenant identity must not yield a scope with an undefined enterprise org.
    expect(() =>
      authorizeEnterpriseScope(
        {
          workspaceId: "w",
          actorId: "a",
          roles: ["identity_admin"],
        } as unknown as EnterpriseServerScope,
        payload,
      ),
    ).toThrow();
  });

  it("requires distinct custodians and bounded break-glass", () => {
    const createdAt = new Date().toISOString();
    const grant = {
      id: crypto.randomUUID(),
      enterpriseOrgId: crypto.randomUUID(),
      trigger: "idp_outage",
      scope: "identity_recovery",
      createdAt,
    };
    const boundedExpiry = new Date(Date.parse(createdAt) + 30 * 60_000).toISOString();
    const overlongExpiry = new Date(Date.parse(createdAt) + 61 * 60_000).toISOString();
    // Each rule is asserted on its own so removing either one fails this test.
    expect(() =>
      BreakGlassGrantSchema.parse({
        ...grant,
        custodianIds: ["same", "same"],
        expiresAt: boundedExpiry,
      }),
    ).toThrow();
    expect(() =>
      BreakGlassGrantSchema.parse({
        ...grant,
        custodianIds: ["one", "two"],
        expiresAt: overlongExpiry,
      }),
    ).toThrow();
    expect(
      BreakGlassGrantSchema.parse({
        ...grant,
        custodianIds: ["one", "two"],
        expiresAt: boundedExpiry,
      }).scope,
    ).toBe("identity_recovery");
  });

  it("requires ordered per-workspace enterprise audit events", () => {
    const event = {
      id: crypto.randomUUID(),
      enterpriseOrgId: crypto.randomUUID(),
      workspaceId: "w",
      sequence: 1,
      eventType: "hold_released",
      actorId: "a",
      authMethod: "passkey",
      targetHash: "hash",
      result: "success",
      previousHash: "hash",
      createdAt: new Date().toISOString(),
    };
    expect(() => AuditStreamEventSchema.parse({ ...event, sequence: 0 })).toThrow();
    // Audit rows are keyed per workspace in storage, so a workspace-less event is not valid.
    expect(() => AuditStreamEventSchema.parse({ ...event, workspaceId: undefined })).toThrow();
    expect(AuditStreamEventSchema.parse(event).sequence).toBe(1);
  });
});
