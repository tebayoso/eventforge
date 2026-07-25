import { describe, expect, it } from "vitest";
import {
  acceptsProviderEvent,
  establishProviderMapping,
  normalizeDatadogMonitorTransition,
  providerGateOpen,
  providerReadinessManifest,
} from "../src/demand-sources.js";

describe("demand source gates", () => {
  it("keeps each provider closed until external evidence is recorded", () => {
    expect(providerReadinessManifest.every((record) => !providerGateOpen(record.provider))).toBe(
      true,
    );
    expect(acceptsProviderEvent("gitlab", "Merge Request Hook", "v1")).toBe(true);
    expect(acceptsProviderEvent("gitlab", "Push Hook", "v1")).toBe(false);
    expect(acceptsProviderEvent("jira", "jira:issue_deleted", "v1")).toBe(false);
  });

  it("opens a provider gate only when every piece of readiness evidence is present", () => {
    const recorded = {
      provider: "gitlab" as const,
      status: "recorded" as const,
      approvalReference: "approval-1",
      eventMatrixVersion: "v1",
      gateEvidence: "recorded" as const,
    };
    expect(providerGateOpen("gitlab", [recorded])).toBe(true);

    // Each piece of evidence is individually load-bearing: dropping any one must
    // close the gate, so a regression that checks only part of the record fails here.
    expect(providerGateOpen("gitlab", [{ ...recorded, status: "unavailable" }])).toBe(false);
    expect(providerGateOpen("gitlab", [{ ...recorded, gateEvidence: "unavailable" }])).toBe(false);
    expect(providerGateOpen("gitlab", [{ ...recorded, approvalReference: undefined }])).toBe(false);
    expect(providerGateOpen("gitlab", [{ ...recorded, approvalReference: "" }])).toBe(false);

    // A record for a different provider must never open this provider's gate.
    expect(providerGateOpen("jira", [recorded])).toBe(false);
    expect(providerGateOpen("gitlab", [])).toBe(false);
  });

  it("requires attested owner-confirmed and workspace-unique provider mappings", () => {
    const mapping = {
      provider: "jira" as const,
      providerAccountId: "site-1",
      resourceId: "project-1",
      workspaceId: "w1",
      installationId: "i1",
      credentialVersion: 1,
      mode: "hosted" as const,
      state: "pending" as const,
    };
    expect(() =>
      establishProviderMapping([], mapping, { attested: true, ownerConfirmed: false }),
    ).toThrow("owner confirmation");
    expect(() =>
      establishProviderMapping(
        [mapping],
        { ...mapping, workspaceId: "w2" },
        { attested: true, ownerConfirmed: true },
      ),
    ).toThrow("another workspace");
  });

  it("admits only allowlisted discrete Datadog monitor transitions", () => {
    expect(
      normalizeDatadogMonitorTransition({
        type: "monitor_alert_transition",
        monitor: { id: "42" },
        transition: { status: "Alert", at: "2026-07-22T00:00:00Z" },
        tags: ["service:api", "query:secret"],
      }),
    ).toEqual({
      monitorId: "42",
      status: "Alert",
      at: "2026-07-22T00:00:00Z",
      tags: ["service:api"],
    });
    expect(normalizeDatadogMonitorTransition({ type: "logs_stream" })).toBeUndefined();
  });

  it("rejects monitor transitions whose status is outside the discrete allowlist", () => {
    const transition = (status: unknown) => ({
      type: "monitor_alert_transition",
      monitor: { id: "42" },
      transition: { status, at: "2026-07-22T00:00:00Z" },
    });

    for (const status of ["OK", "Alert", "Warn", "No Data"]) {
      expect(normalizeDatadogMonitorTransition(transition(status))).toEqual({
        monitorId: "42",
        status,
        at: "2026-07-22T00:00:00Z",
        tags: [],
      });
    }

    // An untrusted webhook body must not smuggle arbitrary content into evidence
    // through `status`, and near-misses must not pass on a substring or case match.
    for (const status of [
      "Triggered",
      "alert",
      "ALERT",
      "Alert ",
      "Alerting",
      "No  Data",
      "",
      "<script>alert(1)</script>",
      "x".repeat(4096),
    ]) {
      expect(normalizeDatadogMonitorTransition(transition(status))).toBeUndefined();
    }
  });
});
