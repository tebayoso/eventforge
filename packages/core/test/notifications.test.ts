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
  eventId: "00000000-0000-4000-8000-000000000023",
  eventVersion: 1,
  workspaceId: "workspace-a",
  eventType: "approval_request",
  title: "Approve @alice <script>secret</script>",
  summary: "See https://private.example/token `hidden`",
  sourceCategory: "github",
  verification: "verified",
  severity: "high",
  lifecycleState: "pending",
  occurredAt: "2026-07-22T00:00:00.000Z",
  correlationId: "corr-23",
  eventforgeUrl: "https://console.eventforge.dev/events/23",
  templateVersion: 1,
};
const route: NotificationRoute = {
  id: "00000000-0000-4000-8000-000000000024",
  version: 1,
  workspaceId: "workspace-a",
  provider: "slack",
  destinationId: "C123",
  active: true,
  healthy: true,
  attestedWorkspaceId: "workspace-a",
  destinationType: "private_channel",
  botIsMember: true,
};

describe("notification sink safety contracts", () => {
  it("renders bounded neutral text and never embeds provider actions", () => {
    const rendered = renderNotification(input, route).text;
    expect(rendered).not.toMatch(/@alice|script|https:\/\/private|`/);
    expect(rendered).toContain("Open in EventForge: https://console.eventforge.dev/events/23");
    expect(safeNotificationText("x".repeat(300))).toHaveLength(200);
  });
  it("fails closed for wrong workspace, non-channel Slack, and removed bot", () => {
    expect(() =>
      renderNotification(input, { ...route, attestedWorkspaceId: "workspace-b" }),
    ).toThrow("attestation");
    expect(() =>
      renderNotification(input, { ...route, destinationType: "pagerduty_change_integration" }),
    ).toThrow("not a channel");
    expect(() => renderNotification(input, { ...route, botIsMember: false })).toThrow(
      "not a channel member",
    );
  });
  it("keys duplicate delivery by event/version/route/template/destination and only allows Change Events", () => {
    expect(logicalNotificationId(input, route)).not.toBe(
      logicalNotificationId(input, { ...route, version: 2 }),
    );
    expect(pagerDutyChangeEventsEndpoint()).toBe("https://events.pagerduty.com/v2/change/enqueue");
  });

  it("strips markup that a single-pass tag filter would leave behind", () => {
    // Removing `<x>` from these first would reassemble a live tag, and a bare `<` is markup too.
    expect(safeNotificationText("<x><script src=a")).not.toContain("<");
    expect(safeNotificationText("<scr<x>ipt>alert(1)")).not.toMatch(/script|<|>/);
    expect(safeNotificationText("a<b>c")).toBe("ac");
  });

  it("neutralizes bracket-heavy text in linear time instead of backtracking", () => {
    const hostile = "<".repeat(200_000);
    const started = performance.now();
    expect(safeNotificationText(hostile)).toBe("");
    // The previous /<[^>]*>/ filter needed >15s for this input; anything near-linear finishes in ms.
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("sanitizes routing metadata, not just title and summary", () => {
    const hostile = renderNotification(
      {
        ...input,
        sourceCategory: "<https://evil.example|github>",
        lifecycleState: "<!here> pending",
        correlationId: "<!channel> @alice `x`",
      },
      route,
    ).text;
    expect(hostile).not.toMatch(/<|>|`|@alice|evil\.example/);
    expect(hostile).toContain("Correlation: reference");
  });

  it("suppresses deep links that are not ordinary http(s) URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "https:///no-host",
    ]) {
      expect(() => renderNotification({ ...input, eventforgeUrl: url }, route)).toThrow(
        "deep link",
      );
    }
    expect(
      renderNotification({ ...input, eventforgeUrl: "http://localhost:3000/events/23" }, route)
        .text,
    ).toContain("Open in EventForge: http://localhost:3000/events/23");
  });

  it("suppresses inactive, unhealthy, and cross-workspace routes", () => {
    expect(() => renderNotification(input, { ...route, active: false })).toThrow(
      "inactive or unhealthy",
    );
    expect(() => renderNotification(input, { ...route, healthy: false })).toThrow(
      "inactive or unhealthy",
    );
    expect(() => renderNotification(input, { ...route, workspaceId: "workspace-b" })).toThrow(
      "attestation",
    );
  });

  it("delivers PagerDuty only through a Change Events destination", () => {
    const pagerduty: NotificationRoute = {
      ...route,
      provider: "pagerduty",
      destinationType: "pagerduty_change_integration",
      botIsMember: undefined,
    };
    expect(() =>
      renderNotification(input, { ...pagerduty, destinationType: "public_channel" }),
    ).toThrow("Change Events integration");
    // A summary-less payload must still render without an empty line.
    const rendered = renderNotification({ ...input, summary: undefined }, pagerduty).text;
    expect(rendered).not.toMatch(/\n\n/);
    expect(rendered.split("\n")).toHaveLength(5);
  });
});
