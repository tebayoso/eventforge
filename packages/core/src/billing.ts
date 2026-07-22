import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const BILLING_CATALOG_VERSION = "2026-07-24";
export const BillingPlanSchema = z.enum(["team", "business"]);
export type BillingPlan = z.infer<typeof BillingPlanSchema>;
export const BillingStateSchema = z.enum([
  "none",
  "trialing",
  "active",
  "past_due",
  "grace",
  "cancel_scheduled",
  "cancelled",
  "disputed",
  "pending_reconciliation",
]);
export type BillingState = z.infer<typeof BillingStateSchema>;

export const BILLING_CATALOG = {
  team: {
    members: 5,
    investigations: 500,
    reactions: 100,
    evidenceDays: 14,
    auditDays: 90,
    capabilities: ["standard_policy_approval", "exports"],
  },
  business: {
    members: 25,
    investigations: 5_000,
    reactions: 1_000,
    evidenceDays: 30,
    auditDays: 365,
    capabilities: ["standard_policy_approval", "exports"],
  },
} as const;

export type BillingConfig = {
  mode: "local" | "remote";
  stripeRestrictedKey?: string;
  stripeWebhookSecret?: string;
  teamPriceId?: string;
  businessPriceId?: string;
  trialEnabled?: boolean;
  taxConfigured?: boolean;
};

export function hostedBillingStatus(config: BillingConfig): { enabled: boolean; reason?: string } {
  if (config.mode !== "remote")
    return { enabled: false, reason: "Hosted billing is unavailable in local mode." };
  if (!config.stripeRestrictedKey?.startsWith("rk_"))
    return { enabled: false, reason: "A restricted Stripe key is required." };
  if (!config.stripeWebhookSecret || !config.teamPriceId || !config.businessPriceId)
    return {
      enabled: false,
      reason: "Stripe webhook and both externally configured recurring Price ids are required.",
    };
  if (!config.taxConfigured)
    return {
      enabled: false,
      reason:
        "Tax is not configured: active registrations and canonical tax configuration must be verified.",
    };
  return { enabled: true };
}

export type EntitlementVersion = {
  workspaceId: string;
  catalogVersion: string;
  state: BillingState;
  plan?: BillingPlan;
  providerEventId: string;
  providerCreatedAt: string;
  observedAt: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  stripeCustomerHash: string;
  stripeSubscriptionHash?: string;
};

const precedence: Record<BillingState, number> = {
  none: 0,
  cancelled: 1,
  past_due: 2,
  grace: 3,
  cancel_scheduled: 4,
  trialing: 5,
  active: 6,
  disputed: 7,
  pending_reconciliation: 8,
};
export function selectCurrentEntitlement(
  versions: EntitlementVersion[],
): EntitlementVersion | undefined {
  return [...versions].sort(
    (a, b) =>
      Date.parse(b.providerCreatedAt) - Date.parse(a.providerCreatedAt) ||
      precedence[b.state] - precedence[a.state] ||
      b.providerEventId.localeCompare(a.providerEventId),
  )[0];
}

export function billingDecision(input: {
  state: BillingState;
  outageHours?: number;
  action: "read" | "investigate" | "reaction" | "change_billing" | "expand";
  withinPriorQuota?: boolean;
}): { allowed: boolean; reason: string } {
  if (input.state === "active" || input.state === "trialing")
    return {
      allowed: input.action !== "reaction" || input.state === "active",
      reason:
        input.state === "trialing" && input.action === "reaction"
          ? "Trial reactions require provider, identity, and MFA gates."
          : "Current entitlement permits this action.",
    };
  if (input.state === "grace")
    return {
      allowed:
        input.action === "read" ||
        (input.action === "investigate" && Boolean(input.withinPriorQuota)),
      reason:
        "Grace preserves reads and prior-quota investigations only; reactions, expansion, and billing changes are denied.",
    };
  if (input.outageHours !== undefined)
    return {
      allowed: input.outageHours <= 24 && input.action === "read",
      reason: "Provider outage permits only previously verified read access for up to 24 hours.",
    };
  return {
    allowed: input.action === "read",
    reason: "Hosted work is suspended; evidence access is preserved.",
  };
}

export function verifyStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const timestamp = signature
    .split(",")
    .find((part) => part.startsWith("t="))
    ?.slice(2);
  const value = signature
    .split(",")
    .find((part) => part.startsWith("v1="))
    ?.slice(3);
  if (!timestamp || !value) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
  const supplied = Buffer.from(value, "hex");
  const actual = Buffer.from(expected, "hex");
  return supplied.length === actual.length && timingSafeEqual(supplied, actual);
}

export function stableBillingIdentity(workspaceId: string, logicalInvestigationId: string): string {
  return createHash("sha256").update(`${workspaceId}:${logicalInvestigationId}`).digest("hex");
}
