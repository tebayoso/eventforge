import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  redactTimelineEntry,
  renderTimelineHtml,
  timelineIntegrityHash,
  timelineManifest,
  verifyTimelineArtifact,
} from "../src/index.js";

const entry = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "w",
  projectId: "p",
  kind: "source_fact" as const,
  receivedAt: "2026-07-22T00:00:00.000Z",
  origin: "fixture",
  integrityHash: "0".repeat(64),
  metadata: { secret: "do-not-export" },
};

describe("timeline foundation", () => {
  it("is repeatable and detects manifest mutation", async () => {
    const manifest = timelineManifest([entry]);
    const hash = await timelineIntegrityHash(manifest);
    expect(
      await timelineIntegrityHash({
        fieldMap: manifest.fieldMap,
        entries: manifest.entries,
        version: 1,
      }),
    ).toBe(hash);
    expect(
      await verifyTimelineArtifact(
        { ...manifest, entries: [{ ...entry, origin: "mutated" }] },
        hash,
      ),
    ).toBe(false);
  });
  it("keeps redaction as an irreversible typed omission and aligns HTML fields", () => {
    const redacted = redactTimelineEntry({ ...entry, redaction: "typed_omission" }, false);
    expect(redacted.metadata).toEqual({ omission: "typed_omission", unavailable: true });
    expect(renderTimelineHtml(timelineManifest([redacted]))).toContain(
      'data-timeline-redaction="typed_omission"',
    );
  });
  it("sorts object keys for canonical bytes", () =>
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}'));
});
