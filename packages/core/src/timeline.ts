import { z } from "zod";

const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Scope = z.object({ workspaceId: z.string().min(1), projectId: z.string().min(1) });

export const TimelineEntrySchema = Scope.extend({
  id: Id,
  kind: z.enum([
    "source_fact",
    "derived_finding",
    "proposal",
    "policy_result",
    "human_decision",
    "attempt",
    "outcome",
  ]),
  causalParentId: Id.optional(),
  canonicalEventId: Id.optional(),
  authoritativeForId: Id.optional(),
  sourceAt: Timestamp.optional(),
  receivedAt: Timestamp,
  origin: z.string().min(1),
  integrityHash: z.string().regex(/^[a-f0-9]{64}$/),
  uncertainty: z.enum(["known", "unknown", "unavailable"]).default("known"),
  redaction: z.enum(["none", "typed_omission", "expired", "deleted"]).default("none"),
  actorId: z.string().min(1).optional(),
  versionRefs: z.record(z.string()).default({}),
  metadata: z.record(z.unknown()).default({}),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelineExportStateSchema = z.enum([
  "snapshot_requested",
  "queued",
  "generating",
  "signed",
  "ready",
  "failed",
  "expired",
]);
export type TimelineExportState = z.infer<typeof TimelineExportStateSchema>;

export const TimelineExportSchema = Scope.extend({
  id: Id,
  timelineVersion: z.string().min(1),
  state: TimelineExportStateSchema,
  manifestHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  keyId: z.string().min(1).optional(),
  createdAt: Timestamp,
});
export type TimelineExport = z.infer<typeof TimelineExportSchema>;

/** RFC 8785-compatible for the JSON values accepted by timeline manifests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON does not allow non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical JSON only permits JSON values.");
}

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export async function timelineIntegrityHash(value: unknown): Promise<string> {
  return hex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalJson(value)))),
  );
}

export type TimelineManifest = {
  version: 1;
  entries: TimelineEntry[];
  fieldMap: Record<string, string>;
};
export function timelineManifest(entries: TimelineEntry[]): TimelineManifest {
  return {
    version: 1,
    entries,
    fieldMap: {
      "/entries/*/kind": "[data-timeline-kind]",
      "/entries/*/uncertainty": "[data-timeline-uncertainty]",
      "/entries/*/redaction": "[data-timeline-redaction]",
    },
  };
}

export function redactTimelineEntry(entry: TimelineEntry, rawAccess: boolean): TimelineEntry {
  if (rawAccess || entry.redaction === "none") return entry;
  return { ...entry, metadata: { omission: entry.redaction, unavailable: true } };
}

export function renderTimelineHtml(manifest: TimelineManifest): string {
  const entries = manifest.entries
    .map(
      (entry) =>
        `<li data-timeline-kind="${entry.kind}" data-timeline-uncertainty="${entry.uncertainty}" data-timeline-redaction="${entry.redaction}">${entry.id}: ${entry.kind} (${entry.redaction === "none" ? entry.uncertainty : entry.redaction})</li>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><ol>${entries}</ol>`;
}

export async function verifyTimelineArtifact(
  manifest: TimelineManifest,
  expectedHash: string,
): Promise<boolean> {
  return (await timelineIntegrityHash(manifest)) === expectedHash;
}
