import { describe, expect, it } from "vitest";
import {
  CorrelationConfigSchema,
  CorrelationEventSchema,
  evaluateCorrelation,
} from "../src/platform.js";

const now = "2026-07-22T12:00:00.000Z";
const config = CorrelationConfigSchema.parse({
  workspaceId: "a",
  projectId: "p",
  version: 1,
  effectiveAt: now,
  windows: {
    repositoryRevisionMinutes: 1440,
    deploymentMinutes: 120,
    fingerprintMinutes: 30,
    providerLinkMinutes: 1440,
  },
});
const event = (id: string, overrides = {}) =>
  CorrelationEventSchema.parse({
    id,
    workspaceId: "a",
    projectId: "p",
    occurredAt: now,
    canonicalIdentity: id,
    ...overrides,
  });

describe("deterministic incident correlation", () => {
  it("uses a strong identifier and returns a stable reason", () => {
    const incoming = event("00000000-0000-4000-8000-000000000001", {
      repositoryId: "repo-1",
      revision: "abc",
    });
    const candidate = event("00000000-0000-4000-8000-000000000002", {
      repositoryId: "repo-1",
      revision: "abc",
    });
    const decision = evaluateCorrelation(incoming, [candidate], config);
    expect(decision).toEqual({
      outcome: "proposed",
      candidateEventId: candidate.id,
      matchedSignals: ["repository_revision"],
      windowMinutes: config.windows.repositoryRevisionMinutes,
      reason: "matched_repository_revision",
    });
    expect(evaluateCorrelation(incoming, [candidate], config)).toEqual(decision);
  });
  it("never groups time-only, cross-workspace, cross-project, or conflicting candidates", () => {
    const incoming = event("00000000-0000-4000-8000-000000000003", { deploymentId: "d" });
    const timeOnly = event("00000000-0000-4000-8000-000000000004");
    const foreign = CorrelationEventSchema.parse({
      ...incoming,
      id: "00000000-0000-4000-8000-000000000005",
      workspaceId: "b",
    });
    const otherProject = CorrelationEventSchema.parse({
      ...incoming,
      id: "00000000-0000-4000-8000-000000000008",
      projectId: "q",
    });
    expect(evaluateCorrelation(incoming, [timeOnly, foreign, otherProject], config)).toEqual({
      outcome: "ungrouped",
      reason: "insufficient_signals",
    });
    const first = event("00000000-0000-4000-8000-000000000006", { deploymentId: "d" });
    const second = event("00000000-0000-4000-8000-000000000007", { deploymentId: "d" });
    expect(evaluateCorrelation(incoming, [first, second], config)).toEqual({
      outcome: "ungrouped",
      reason: "ambiguous_candidates",
    });
  });
  it("distinguishes a shared signal that fell outside its window from no shared signal at all", () => {
    const incoming = event("00000000-0000-4000-8000-000000000009", { deploymentId: "d" });
    const stale = event("00000000-0000-4000-8000-00000000000a", {
      deploymentId: "d",
      occurredAt: new Date(
        Date.parse(now) + (config.windows.deploymentMinutes + 1) * 60_000,
      ).toISOString(),
    });
    expect(evaluateCorrelation(incoming, [stale], config)).toEqual({
      outcome: "ungrouped",
      reason: "outside_window",
    });
    const unrelated = event("00000000-0000-4000-8000-00000000000b", { deploymentId: "other" });
    expect(evaluateCorrelation(incoming, [unrelated], config)).toEqual({
      outcome: "ungrouped",
      reason: "insufficient_signals",
    });
  });
  it("matches provider links and service/environment fingerprints in their own windows", () => {
    const linkIncoming = event("00000000-0000-4000-8000-00000000000c", {
      providerLink: "https://provider.example/incident/1",
    });
    const linked = event("00000000-0000-4000-8000-00000000000d", {
      providerLink: "https://provider.example/incident/1",
    });
    expect(evaluateCorrelation(linkIncoming, [linked], config)).toEqual({
      outcome: "proposed",
      candidateEventId: linked.id,
      matchedSignals: ["provider_link"],
      windowMinutes: config.windows.providerLinkMinutes,
      reason: "matched_provider_link",
    });

    const fingerprinted = { serviceId: "svc", environmentId: "env", issueFingerprint: "fp" };
    const fpIncoming = event("00000000-0000-4000-8000-00000000000e", fingerprinted);
    const fpCandidate = event("00000000-0000-4000-8000-00000000000f", fingerprinted);
    expect(evaluateCorrelation(fpIncoming, [fpCandidate], config)).toEqual({
      outcome: "proposed",
      candidateEventId: fpCandidate.id,
      matchedSignals: ["service_environment_fingerprint"],
      windowMinutes: config.windows.fingerprintMinutes,
      reason: "matched_service_environment_fingerprint",
    });

    const staleFingerprint = event("00000000-0000-4000-8000-000000000010", {
      ...fingerprinted,
      occurredAt: new Date(
        Date.parse(now) + (config.windows.fingerprintMinutes + 1) * 60_000,
      ).toISOString(),
    });
    expect(evaluateCorrelation(fpIncoming, [staleFingerprint], config)).toEqual({
      outcome: "ungrouped",
      reason: "outside_window",
    });
  });
  it("rejects windows outside launch bounds", () => {
    expect(() =>
      CorrelationConfigSchema.parse({
        ...config,
        windows: { ...config.windows, deploymentMinutes: 121 },
      }),
    ).toThrow();
  });
});
