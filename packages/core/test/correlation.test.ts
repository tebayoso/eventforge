import { describe, expect, it } from "vitest";
import { CorrelationConfigSchema, CorrelationEventSchema, evaluateCorrelation } from "../src/index.js";

const now = "2026-07-22T12:00:00.000Z";
const config = CorrelationConfigSchema.parse({ workspaceId: "a", projectId: "p", version: 1, effectiveAt: now, windows: { repositoryRevisionMinutes: 1440, deploymentMinutes: 120, fingerprintMinutes: 30, providerLinkMinutes: 1440 } });
const event = (id: string, overrides = {}) => CorrelationEventSchema.parse({ id, workspaceId: "a", projectId: "p", occurredAt: now, canonicalIdentity: id, ...overrides });

describe("deterministic incident correlation", () => {
  it("uses a strong identifier and returns a stable reason", () => {
    const incoming = event("00000000-0000-4000-8000-000000000001", { repositoryId: "repo-1", revision: "abc" });
    const candidate = event("00000000-0000-4000-8000-000000000002", { repositoryId: "repo-1", revision: "abc" });
    expect(evaluateCorrelation(incoming, [candidate], config)).toEqual(evaluateCorrelation(incoming, [candidate], config));
  });
  it("never groups time-only, cross-workspace, or conflicting candidates", () => {
    const incoming = event("00000000-0000-4000-8000-000000000003", { deploymentId: "d" });
    const timeOnly = event("00000000-0000-4000-8000-000000000004");
    const foreign = CorrelationEventSchema.parse({ ...incoming, id: "00000000-0000-4000-8000-000000000005", workspaceId: "b" });
    expect(evaluateCorrelation(incoming, [timeOnly, foreign], config)).toEqual({ outcome: "ungrouped", reason: "outside_window" });
    const first = event("00000000-0000-4000-8000-000000000006", { deploymentId: "d" });
    const second = event("00000000-0000-4000-8000-000000000007", { deploymentId: "d" });
    expect(evaluateCorrelation(incoming, [first, second], config)).toEqual({ outcome: "ungrouped", reason: "ambiguous_candidates" });
  });
  it("rejects windows outside launch bounds", () => {
    expect(() => CorrelationConfigSchema.parse({ ...config, windows: { ...config.windows, deploymentMinutes: 121 } })).toThrow();
  });
});
