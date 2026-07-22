import { describe, expect, it } from "vitest";
import {
  logicalNotificationId,
  pagerDutyChangeEventsEndpoint,
  renderNotification,
  safeNotificationText,
  type NotificationInput,
  type NotificationRoute,
} from "../src/index.js";

const input: NotificationInput = {
  eventId: "00000000-0000-4000-8000-000000000023", eventVersion: 1, workspaceId: "workspace-a",
  eventType: "approval_request", title: "Approve @alice <script>secret</script>", summary: "See https://private.example/token `hidden`",
  sourceCategory: "github", verification: "verified", severity: "high", lifecycleState: "pending",
  occurredAt: "2026-07-22T00:00:00.000Z", correlationId: "corr-23", eventforgeUrl: "https://console.eventforge.dev/events/23", templateVersion: 1,
};
const route: NotificationRoute = { id: "00000000-0000-4000-8000-000000000024", version: 1, workspaceId: "workspace-a", provider: "slack", destinationId: "C123", active: true, healthy: true, attestedWorkspaceId: "workspace-a", destinationType: "private_channel", botIsMember: true };

describe("notification sink safety contracts", () => {
  it("renders bounded neutral text and never embeds provider actions", () => {
    const rendered = renderNotification(input, route).text;
    expect(rendered).not.toMatch(/@alice|script|https:\/\/private|`/);
    expect(rendered).toContain("Open in EventForge: https://console.eventforge.dev/events/23");
    expect(safeNotificationText("x".repeat(300))).toHaveLength(200);
  });
  it("fails closed for wrong workspace, non-channel Slack, and removed bot", () => {
    expect(() => renderNotification(input, { ...route, attestedWorkspaceId: "workspace-b" })).toThrow("attestation");
    expect(() => renderNotification(input, { ...route, destinationType: "pagerduty_change_integration" })).toThrow("not a channel");
    expect(() => renderNotification(input, { ...route, botIsMember: false })).toThrow("not a channel member");
  });
  it("keys duplicate delivery by event/version/route/template/destination and only allows Change Events", () => {
    expect(logicalNotificationId(input, route)).not.toBe(logicalNotificationId(input, { ...route, version: 2 }));
    expect(pagerDutyChangeEventsEndpoint()).toBe("https://events.pagerduty.com/v2/change/enqueue");
  });
});
