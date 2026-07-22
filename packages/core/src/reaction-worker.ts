import { createHash } from "node:crypto";
import { z } from "zod";

const Id = z.string().uuid();
const ExactText = z.string().min(1).refine((value) => value === value.trim(), "must be normalized");

export const ReactionActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("github.comment"), content: ExactText }),
  z.object({ type: z.literal("github.labels"), add: z.array(ExactText).default([]), remove: z.array(ExactText).default([]) })
    .refine((value) => value.add.length + value.remove.length > 0, "must change a label"),
  z.object({ type: z.literal("linear.comment"), content: ExactText }),
  z.object({ type: z.literal("linear.transition"), stateId: ExactText }),
  z.object({ type: z.literal("linear.priority"), priority: z.enum(["urgent", "high", "medium", "low", "none"]) }),
]);
export type ReactionAction = z.infer<typeof ReactionActionSchema>;

export const ReactionEnvelopeSchema = z.object({
  id: Id,
  workspaceId: ExactText,
  installationId: ExactText,
  provider: z.enum(["github", "linear"]),
  resource: ExactText,
  action: ReactionActionSchema,
  policyVersion: z.number().int().positive(),
  policyRule: ExactText,
  approvalId: Id,
  approvalVersion: z.number().int().positive(),
  approverId: ExactText,
  expiresAt: z.string().datetime(),
  budgetClass: z.enum(["github_comment", "github_label", "linear_effect"]),
  idempotencyKey: ExactText,
  hash: z.string().length(64),
});
export type ReactionEnvelope = z.infer<typeof ReactionEnvelopeSchema>;

export type Approval = Pick<ReactionEnvelope, "approvalId" | "approvalVersion" | "approverId" | "expiresAt" | "hash"> & {
  active: boolean;
  used: boolean;
};
export type ReactionAuthority = {
  available: boolean;
  policyVersion: number;
  allowedResources: readonly string[];
  allowedActionTypes: readonly ReactionAction["type"][];
  linearStateIds?: readonly string[];
  githubLabels?: readonly string[];
  killEpochAt: Date;
  killed?: boolean;
  credentialActive: boolean;
  budgetAvailable: boolean;
  resourceSlotsAvailable: boolean;
  workspaceSlotsAvailable: boolean;
};
export type Reservation = { allowed: true; businessId: string } | { allowed: false; reason: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedAction(action: ReactionAction): ReactionAction {
  if (action.type !== "github.labels") return action;
  const add = [...new Set(action.add)].sort();
  const remove = [...new Set(action.remove)].sort();
  if (add.some((label) => remove.includes(label))) throw new Error("label cannot be both added and removed");
  return { ...action, add, remove };
}

/** Hash only schema-normalized, exact effect inputs. Normalization may reject but cannot add scope. */
export function reactionHash(input: Omit<ReactionEnvelope, "hash">): string {
  const parsed = ReactionEnvelopeSchema.omit({ hash: true }).parse({ ...input, action: normalizedAction(input.action) });
  return createHash("sha256").update(canonical(parsed)).digest("hex");
}

export function createReactionEnvelope(input: Omit<ReactionEnvelope, "hash">): ReactionEnvelope {
  const normalized = { ...input, action: normalizedAction(ReactionActionSchema.parse(input.action)) };
  return ReactionEnvelopeSchema.parse({ ...normalized, hash: reactionHash(normalized) });
}

/** A transaction adapter must make reservation and budget/concurrency consumption atomic. */
export function reserveReaction(input: { envelope: ReactionEnvelope; approval: Approval | undefined; authority: ReactionAuthority | undefined; now: Date }): Reservation {
  const { envelope, approval, authority, now } = input;
  const expected = reactionHash({ ...envelope, hash: undefined } as Omit<ReactionEnvelope, "hash">);
  if (expected !== envelope.hash) return { allowed: false, reason: "envelope_hash_mismatch" };
  if (!approval || !authority) return { allowed: false, reason: "authority_unavailable" };
  if (!approval.active || approval.used || approval.hash !== envelope.hash || approval.approvalId !== envelope.approvalId || approval.approvalVersion !== envelope.approvalVersion || approval.approverId !== envelope.approverId) return { allowed: false, reason: "approval_invalid" };
  if (new Date(envelope.expiresAt) <= now || new Date(approval.expiresAt) <= now || approval.expiresAt !== envelope.expiresAt) return { allowed: false, reason: "approval_expired" };
  if (!authority.available || authority.killed || now.getTime() - authority.killEpochAt.getTime() > 30_000) return { allowed: false, reason: "kill_state_unavailable" };
  if (authority.policyVersion !== envelope.policyVersion || !authority.allowedResources.includes(envelope.resource) || !authority.allowedActionTypes.includes(envelope.action.type) || !authority.credentialActive) return { allowed: false, reason: "policy_or_scope_denied" };
  if ((envelope.provider === "github") !== envelope.action.type.startsWith("github.")) return { allowed: false, reason: "provider_action_mismatch" };
  if (envelope.action.type === "linear.transition" && !authority.linearStateIds?.includes(envelope.action.stateId)) return { allowed: false, reason: "linear_state_denied" };
  if (envelope.action.type === "github.labels" && [...envelope.action.add, ...envelope.action.remove].some((label) => !authority.githubLabels?.includes(label))) return { allowed: false, reason: "github_label_denied" };
  if (!authority.budgetAvailable) return { allowed: false, reason: "budget_exhausted" };
  if (!authority.resourceSlotsAvailable || !authority.workspaceSlotsAvailable) return { allowed: false, reason: "concurrency_exhausted" };
  return { allowed: true, businessId: envelope.idempotencyKey };
}
