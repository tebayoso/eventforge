import { describe, expect, it } from "vitest";
import { acceptsProviderEvent, establishProviderMapping, normalizeDatadogMonitorTransition, providerGateOpen, providerReadinessManifest } from "./demand-sources.js";

describe("demand source gates", () => {
  it("keeps each provider closed until external evidence is recorded", () => {
    expect(providerReadinessManifest.every((record) => !providerGateOpen(record.provider))).toBe(true);
    expect(acceptsProviderEvent("gitlab", "Merge Request Hook", "v1")).toBe(true);
    expect(acceptsProviderEvent("gitlab", "Push Hook", "v1")).toBe(false);
    expect(acceptsProviderEvent("jira", "jira:issue_deleted", "v1")).toBe(false);
  });

  it("requires attested owner-confirmed and workspace-unique provider mappings", () => {
    const mapping = { provider: "jira" as const, providerAccountId: "site-1", resourceId: "project-1", workspaceId: "w1", installationId: "i1", credentialVersion: 1, mode: "hosted" as const, state: "pending" as const };
    expect(() => establishProviderMapping([], mapping, { attested: true, ownerConfirmed: false })).toThrow("owner confirmation");
    expect(() => establishProviderMapping([mapping], { ...mapping, workspaceId: "w2" }, { attested: true, ownerConfirmed: true })).toThrow("another workspace");
  });

  it("admits only allowlisted discrete Datadog monitor transitions", () => {
    expect(normalizeDatadogMonitorTransition({ type: "monitor_alert_transition", monitor: { id: "42" }, transition: { status: "Alert", at: "2026-07-22T00:00:00Z" }, tags: ["service:api", "query:secret"] })).toEqual({ monitorId: "42", status: "Alert", at: "2026-07-22T00:00:00Z", tags: ["service:api"] });
    expect(normalizeDatadogMonitorTransition({ type: "logs_stream" })).toBeUndefined();
  });
});
