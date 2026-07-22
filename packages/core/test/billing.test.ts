import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BILLING_CATALOG,
  billingDecision,
  hostedBillingStatus,
  selectCurrentEntitlement,
  stableBillingIdentity,
  verifyStripeWebhook,
} from "../src/index.js";

describe("billing and entitlements", () => {
  it("uses the fixed Team and Business outcome catalog", () => {
    expect(BILLING_CATALOG.team).toMatchObject({
      members: 5,
      investigations: 500,
      reactions: 100,
      evidenceDays: 14,
      auditDays: 90,
    });
    expect(BILLING_CATALOG.business).toMatchObject({
      members: 25,
      investigations: 5_000,
      reactions: 1_000,
      evidenceDays: 30,
      auditDays: 365,
    });
  });
  it("fails hosted billing closed until restricted credentials, price ids, and confirmed tax exist", () => {
    expect(
      hostedBillingStatus({
        mode: "remote",
        stripeRestrictedKey: "sk_not_allowed",
        stripeWebhookSecret: "whsec_x",
        teamPriceId: "price_team",
        businessPriceId: "price_business",
        taxConfigured: true,
      }).enabled,
    ).toBe(false);
    expect(
      hostedBillingStatus({
        mode: "remote",
        stripeRestrictedKey: "rk_least_privilege",
        stripeWebhookSecret: "whsec_x",
        teamPriceId: "price_team",
        businessPriceId: "price_business",
        taxConfigured: false,
      }).reason,
    ).toContain("Tax is not configured");
  });
  it("does not let late provider events regress the current entitlement", () => {
    const current = selectCurrentEntitlement([
      {
        workspaceId: "w",
        catalogVersion: "v",
        state: "cancelled",
        providerEventId: "evt_old",
        providerCreatedAt: "2026-07-01T00:00:00.000Z",
        observedAt: "2026-07-01T00:00:00.000Z",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        stripeCustomerHash: "c",
      },
      {
        workspaceId: "w",
        catalogVersion: "v",
        state: "active",
        providerEventId: "evt_new",
        providerCreatedAt: "2026-07-02T00:00:00.000Z",
        observedAt: "2026-07-02T00:00:00.000Z",
        effectiveFrom: "2026-07-02T00:00:00.000Z",
        stripeCustomerHash: "c",
      },
    ]);
    expect(current?.providerEventId).toBe("evt_new");
  });
  it("keeps grace and outage read-only while safety gates deny reactions", () => {
    expect(
      billingDecision({ state: "grace", action: "investigate", withinPriorQuota: true }).allowed,
    ).toBe(true);
    expect(billingDecision({ state: "grace", action: "reaction" }).allowed).toBe(false);
    expect(billingDecision({ state: "past_due", outageHours: 25, action: "read" }).allowed).toBe(
      false,
    );
  });
  it("counts retries and replays once by workspace and logical investigation identity", () => {
    expect(stableBillingIdentity("w", "logical-1")).toBe(stableBillingIdentity("w", "logical-1"));
    expect(stableBillingIdentity("w", "logical-1")).not.toBe(
      stableBillingIdentity("other", "logical-1"),
    );
  });
  it("accepts only a valid raw Stripe signature", () => {
    const raw = Buffer.from('{"id":"evt_1"}');
    const timestamp = "1721600000";
    const signature = createHmac("sha256", "whsec_test")
      .update(`${timestamp}.`)
      .update(raw)
      .digest("hex");
    expect(verifyStripeWebhook(raw, `t=${timestamp},v1=${signature}`, "whsec_test")).toBe(true);
    expect(
      verifyStripeWebhook(
        Buffer.from('{"id":"evt_2"}'),
        `t=${timestamp},v1=${signature}`,
        "whsec_test",
      ),
    ).toBe(false);
  });
});
