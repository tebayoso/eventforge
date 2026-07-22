import { z } from "zod";

export const ProviderInstallationStateSchema = z.enum([
  "pending",
  "healthy",
  "degraded",
  "expired",
  "revoked",
  "misconfigured",
  "disconnected",
]);
export type ProviderInstallationState = z.infer<typeof ProviderInstallationStateSchema>;

export const ProviderInstallationModeSchema = z.enum(["read_only", "reaction_enabled"]);
export type ProviderInstallationMode = z.infer<typeof ProviderInstallationModeSchema>;

export const ProviderResourceSelectionSchema = z.object({
  mode: z.enum(["selective", "all_discovered"]),
  resourceIds: z.array(z.string().min(1)).min(1),
  confirmedAt: z.string().datetime(),
});

export const ProviderInstallationSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(["linear", "sentry"]),
    workspaceId: z.string().min(1),
    providerAccountId: z.string().min(1),
    installationKey: z.string().min(1),
    mode: ProviderInstallationModeSchema,
    resources: ProviderResourceSelectionSchema,
    state: ProviderInstallationStateSchema,
    scopeVersion: z.number().int().positive(),
    checkedAt: z.string().datetime().optional(),
    lastVerifiedEventAt: z.string().datetime().optional(),
  })
  .superRefine((value, context) => {
    if (value.provider === "sentry" && value.mode === "reaction_enabled")
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Sentry is read-only." });
  });
export type ProviderInstallation = z.infer<typeof ProviderInstallationSchema>;

const LinearReactionActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_comment"), comment: z.string().min(1).max(5_000) }),
  z.object({ kind: z.literal("transition"), stateId: z.string().min(1) }),
  z.object({ kind: z.literal("update_priority"), priority: z.number().int().min(0).max(4) }),
]);

export const LinearReactionRequestSchema = z
  .object({
    installation: ProviderInstallationSchema.extend({
      provider: z.literal("linear"),
      mode: z.literal("reaction_enabled"),
      state: z.literal("healthy"),
    }),
    issueId: z.string().min(1),
    action: LinearReactionActionSchema,
    allowedStateIds: z.array(z.string().min(1)).default([]),
  })
  .superRefine((value, context) => {
    if (value.action.kind === "transition" && !value.allowedStateIds.includes(value.action.stateId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Linear state is not allowlisted.",
      });
  });

export function isProviderInstallationUsable(installation: ProviderInstallation): boolean {
  return installation.state === "healthy";
}
