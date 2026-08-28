import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BILLING_CATALOG,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  billingDecision,
  hostedBillingStatus,
  selectCurrentEntitlement,
  stableBillingIdentity,
  verifyStripeWebhook,
} from "../src/billing.js";

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
    const fresh = { nowSeconds: Number(timestamp) };
    expect(verifyStripeWebhook(raw, `t=${timestamp},v1=${signature}`, "whsec_test", fresh)).toBe(
      true,
    );
    expect(
      verifyStripeWebhook(
        Buffer.from('{"id":"evt_2"}'),
        `t=${timestamp},v1=${signature}`,
        "whsec_test",
        fresh,
      ),
    ).toBe(false);
  });
  it("never enables hosted billing in local mode or without a configured key", () => {
    const complete = {
      stripeRestrictedKey: "rk_least_privilege",
      stripeWebhookSecret: "whsec_x",
      teamPriceId: "price_team",
      businessPriceId: "price_business",
      taxConfigured: true,
    };
    expect(hostedBillingStatus({ ...complete, mode: "local" })).toMatchObject({
      enabled: false,
      reason: "Hosted billing is unavailable in local mode.",
    });
    expect(
      hostedBillingStatus({
        ...complete,
        mode: "remote",
        stripeRestrictedKey: undefined,
      }).enabled,
    ).toBe(false);
  });
  it("treats each missing webhook secret or Price id as an independent hosted billing blocker", () => {
    const complete = {
      mode: "remote" as const,
      stripeRestrictedKey: "rk_least_privilege",
      stripeWebhookSecret: "whsec_x",
      teamPriceId: "price_team",
      businessPriceId: "price_business",
      taxConfigured: true,
    };
    for (const missing of ["stripeWebhookSecret", "teamPriceId", "businessPriceId"] as const) {
      expect(hostedBillingStatus({ ...complete, [missing]: undefined })).toMatchObject({
        enabled: false,
        reason: "Stripe webhook and both externally configured recurring Price ids are required.",
      });
    }
    expect(hostedBillingStatus(complete)).toEqual({ enabled: true });
  });
  it("breaks entitlement ties toward the state that withholds hosted work", () => {
    const base = {
      workspaceId: "w",
      catalogVersion: "v",
      providerCreatedAt: "2026-07-02T00:00:00.000Z",
      observedAt: "2026-07-02T00:00:00.000Z",
      effectiveFrom: "2026-07-02T00:00:00.000Z",
      stripeCustomerHash: "c",
    };
    expect(
      selectCurrentEntitlement([
        { ...base, state: "active", providerEventId: "evt_a" },
        { ...base, state: "disputed", providerEventId: "evt_b" },
      ])?.state,
    ).toBe("disputed");
    expect(
      selectCurrentEntitlement([
        { ...base, state: "active", providerEventId: "evt_a" },
        { ...base, state: "active", providerEventId: "evt_b" },
      ])?.providerEventId,
    ).toBe("evt_b");
    expect(selectCurrentEntitlement([])).toBeUndefined();
  });
  it("only lets a paid active entitlement authorize reactions and expansion", () => {
    expect(billingDecision({ state: "active", action: "reaction" }).allowed).toBe(true);
    expect(billingDecision({ state: "active", action: "expand" }).allowed).toBe(true);
    expect(billingDecision({ state: "trialing", action: "investigate" }).allowed).toBe(true);
    expect(billingDecision({ state: "trialing", action: "reaction" })).toMatchObject({
      allowed: false,
      reason: "Trial reactions require provider, identity, and MFA gates.",
    });
    expect(billingDecision({ state: "grace", action: "read" }).allowed).toBe(true);
    expect(
      billingDecision({ state: "grace", action: "investigate", withinPriorQuota: false }).allowed,
    ).toBe(false);
  });
  it("suspends hosted work but preserves evidence reads once entitlement lapses", () => {
    for (const state of ["cancelled", "past_due", "none", "pending_reconciliation"] as const) {
      expect(billingDecision({ state, action: "read" }).allowed).toBe(true);
      for (const action of ["investigate", "reaction", "expand", "change_billing"] as const) {
        expect(billingDecision({ state, action }).allowed).toBe(false);
      }
    }
    expect(billingDecision({ state: "past_due", outageHours: 12, action: "read" }).allowed).toBe(
      true,
    );
  });
  it("rejects absent, malformed, and wrong-length Stripe signature headers", () => {
    const raw = Buffer.from('{"id":"evt_1"}');
    const timestamp = "1721600000";
    const fresh = { nowSeconds: Number(timestamp) };
    expect(verifyStripeWebhook(raw, undefined, "whsec_test", fresh)).toBe(false);
    expect(verifyStripeWebhook(raw, "", "whsec_test", fresh)).toBe(false);
    expect(verifyStripeWebhook(raw, `t=${timestamp}`, "whsec_test", fresh)).toBe(false);
    expect(verifyStripeWebhook(raw, "v1=deadbeef", "whsec_test", fresh)).toBe(false);
    expect(verifyStripeWebhook(raw, `t=${timestamp},v1=ab`, "whsec_test", fresh)).toBe(false);
    expect(verifyStripeWebhook(raw, `t=not-a-number,v1=deadbeef`, "whsec_test", fresh)).toBe(false);
    const otherSecret = createHmac("sha256", "whsec_other")
      .update(`${timestamp}.`)
      .update(raw)
      .digest("hex");
    expect(verifyStripeWebhook(raw, `t=${timestamp},v1=${otherSecret}`, "whsec_test", fresh)).toBe(
      false,
    );
  });
  it("denies reactions and expansion during a provider outage even on an active entitlement", () => {
    for (const state of ["active", "trialing", "grace"] as const) {
      for (const action of ["reaction", "expand", "investigate", "change_billing"] as const) {
        expect(
          billingDecision({ state, outageHours: 400, action, withinPriorQuota: true }),
        ).toMatchObject({
          allowed: false,
          reason:
            "Provider outage permits only previously verified read access for up to 24 hours.",
        });
      }
      expect(billingDecision({ state, outageHours: 4, action: "read" }).allowed).toBe(true);
      expect(billingDecision({ state, outageHours: 25, action: "read" }).allowed).toBe(false);
    }
  });
  it("ignores entitlement versions the provider schema cannot validate", () => {
    const base = {
      workspaceId: "w",
      catalogVersion: "v",
      observedAt: "2026-07-01T00:00:00.000Z",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      stripeCustomerHash: "c",
    };
    const cancelled = {
      ...base,
      state: "cancelled" as const,
      providerEventId: "evt_cancelled",
      providerCreatedAt: "2026-07-09T00:00:00.000Z",
    };
    expect(
      selectCurrentEntitlement([
        cancelled,
        {
          ...base,
          state: "active",
          providerEventId: "evt_garbage",
          providerCreatedAt: "not-a-date",
        },
      ])?.providerEventId,
    ).toBe("evt_cancelled");
    expect(
      selectCurrentEntitlement([
        cancelled,
        {
          ...base,
          state: "totally_paid" as unknown as "active",
          providerEventId: "evt_bad_state",
          providerCreatedAt: "2026-07-20T00:00:00.000Z",
        },
      ])?.providerEventId,
    ).toBe("evt_cancelled");
    expect(
      selectCurrentEntitlement([
        { ...base, state: "active", providerEventId: "evt_only", providerCreatedAt: "not-a-date" },
      ]),
    ).toBeUndefined();
  });
  it("rejects a correctly signed webhook whose timestamp is outside the replay tolerance", () => {
    const raw = Buffer.from('{"id":"evt_1"}');
    const timestamp = "1721600000";
    const signature = createHmac("sha256", "whsec_test")
      .update(`${timestamp}.`)
      .update(raw)
      .digest("hex");
    const header = `t=${timestamp},v1=${signature}`;
    const issuedAt = Number(timestamp);
    expect(STRIPE_WEBHOOK_TOLERANCE_SECONDS).toBe(300);
    expect(verifyStripeWebhook(raw, header, "whsec_test", { nowSeconds: issuedAt })).toBe(true);
    expect(
      verifyStripeWebhook(raw, header, "whsec_test", {
        nowSeconds: issuedAt + STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      }),
    ).toBe(true);
    expect(
      verifyStripeWebhook(raw, header, "whsec_test", {
        nowSeconds: issuedAt + STRIPE_WEBHOOK_TOLERANCE_SECONDS + 1,
      }),
    ).toBe(false);
    expect(
      verifyStripeWebhook(raw, header, "whsec_test", {
        nowSeconds: issuedAt - STRIPE_WEBHOOK_TOLERANCE_SECONDS - 1,
      }),
    ).toBe(false);
    expect(verifyStripeWebhook(raw, header, "whsec_test")).toBe(false);
  });
});
