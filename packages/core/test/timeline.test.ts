import { describe, expect, it } from "vitest";
import {
  canonicalRfc8785Json,
  redactTimelineEntry,
  renderTimelineHtml,
  type TimelineEntry,
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
  uncertainty: "known" as const,
  redaction: "none" as const,
  versionRefs: {},
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
    expect(canonicalRfc8785Json({ b: 1, a: 2 })).toBe('{"a":2,"b":1}'));

  it("orders keys by UTF-16 code unit as RFC 8785 requires, not by collation", () => {
    // Locale collation orders these as _, a, A, b, Z; RFC 8785 mandates code-unit order.
    expect(canonicalRfc8785Json({ b: 1, A: 2, _: 3, Z: 4, a: 5 })).toBe(
      '{"A":2,"Z":4,"_":3,"a":5,"b":1}',
    );
  });

  it("produces insertion-order-independent bytes for collation-equal keys", () => {
    // Precomposed U+00E9 and decomposed "e" + U+0301 are distinct keys that
    // localeCompare reports as equal, which would otherwise leak key insertion
    // order into the integrity hash.
    const nfc = String.fromCharCode(0x00e9);
    const nfd = "e" + String.fromCharCode(0x0301);
    expect(nfc).not.toBe(nfd);
    expect(nfc.localeCompare(nfd)).toBe(0);
    expect(canonicalRfc8785Json({ [nfc]: 1, [nfd]: 2 })).toBe(
      canonicalRfc8785Json({ [nfd]: 2, [nfc]: 1 }),
    );
    // Code-unit order puts the decomposed form first because 0x65 < 0xe9.
    expect(canonicalRfc8785Json({ [nfc]: 1, [nfd]: 2 })).toBe(
      `{${JSON.stringify(nfd)}:2,${JSON.stringify(nfc)}:1}`,
    );
  });

  it("escapes entry fields so a manifest cannot inject markup or attributes", () => {
    const hostile = {
      ...entry,
      id: "<script>alert(1)</script>",
      uncertainty: '" onmouseover="steal()',
    } as unknown as TimelineEntry;
    const html = renderTimelineHtml(timelineManifest([hostile]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The field map promises each value stays inside its own attribute.
    expect(html).not.toContain('onmouseover="');
    expect(html).toContain('data-timeline-uncertainty="&quot; onmouseover=&quot;steal()"');
  });
});
