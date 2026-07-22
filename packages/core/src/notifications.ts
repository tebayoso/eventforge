import { createHash } from "node:crypto";
import { z } from "zod";

export const NotificationProviderSchema = z.enum(["slack", "pagerduty"]);
export type NotificationProvider = z.infer<typeof NotificationProviderSchema>;
export const NotificationStateSchema = z.enum([
  "queued",
  "sending",
  "provider_accepted",
  "delivered",
  "failed",
  "retrying",
  "suppressed",
  "unknown",
]);
export type NotificationState = z.infer<typeof NotificationStateSchema>;

const EventTypeSchema = z.enum([
  "investigation",
  "approval_request",
  "decision",
  "reaction_outcome",
  "critical_integration_degradation",
]);
const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);

export const NotificationRouteSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  workspaceId: z.string().min(1),
  provider: NotificationProviderSchema,
  destinationId: z.string().min(1),
  active: z.boolean(),
  healthy: z.boolean(),
  attestedWorkspaceId: z.string().min(1),
  destinationType: z.enum(["public_channel", "private_channel", "pagerduty_change_integration"]),
  botIsMember: z.boolean().optional(),
});
export type NotificationRoute = z.infer<typeof NotificationRouteSchema>;

export const NotificationInputSchema = z.object({
  eventId: z.string().uuid(),
  eventVersion: z.number().int().positive(),
  workspaceId: z.string().min(1),
  eventType: EventTypeSchema,
  title: z.string(),
  summary: z.string().optional(),
  sourceCategory: z.string().min(1).max(80),
  verification: z.enum(["verified", "unverified"]),
  severity: SeveritySchema,
  lifecycleState: z.string().min(1).max(80),
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(1).max(160),
  eventforgeUrl: z.string().url(),
  templateVersion: z.number().int().positive(),
});
export type NotificationInput = z.infer<typeof NotificationInputSchema>;

/** Notification text is deliberately plain, bounded, and cannot mention people or render provider markup. */
export function safeNotificationText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[@#][A-Za-z0-9_-]+/g, "[reference]")
    .replace(/[\\`*_~>|{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function logicalNotificationId(input: NotificationInput, route: NotificationRoute): string {
  return createHash("sha256")
    .update([input.eventId, input.eventVersion, route.version, input.templateVersion, route.destinationId].join(":"))
    .digest("hex");
}

export function validateNotificationRoute(input: NotificationInput, route: NotificationRoute): string | undefined {
  if (!route.active || !route.healthy) return "route is inactive or unhealthy";
  if (route.workspaceId !== input.workspaceId || route.attestedWorkspaceId !== input.workspaceId)
    return "workspace attestation mismatch";
  if (route.provider === "slack") {
    if (!(["public_channel", "private_channel"] as string[]).includes(route.destinationType))
      return "Slack destination is not a channel";
    if (!route.botIsMember) return "Slack bot is not a channel member";
  }
  if (route.provider === "pagerduty" && route.destinationType !== "pagerduty_change_integration")
    return "PagerDuty destination is not a Change Events integration";
  return undefined;
}

export function renderNotification(input: NotificationInput, route: NotificationRoute): { text: string; logicalId: string } {
  const blocked = validateNotificationRoute(input, route);
  if (blocked) throw new Error(`Notification suppressed: ${blocked}`);
  const title = safeNotificationText(input.title);
  const summary = input.summary ? safeNotificationText(input.summary) : "";
  const text = [
    `[EventForge] ${input.eventType} (${input.severity})`,
    title,
    summary,
    `Source: ${input.sourceCategory}; verification: ${input.verification}; state: ${input.lifecycleState}`,
    `Correlation: ${input.correlationId}`,
    `Open in EventForge: ${input.eventforgeUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { text, logicalId: logicalNotificationId(input, route) };
}

/** Only this endpoint is legal for PagerDuty launch traffic; alert/incident APIs are intentionally absent. */
export function pagerDutyChangeEventsEndpoint(): "https://events.pagerduty.com/v2/change/enqueue" {
  return "https://events.pagerduty.com/v2/change/enqueue";
}
