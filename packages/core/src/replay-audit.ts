import { createHash, randomUUID } from "node:crypto";

export type Attribution = { actorId: string; workspaceId: string; sessionId: string; authenticationMethod: string; mfaAt: string; requestedAt: string; ipHash: string; userAgentClass: string };
export type Evidence = { id: string; workspaceId: string; content: string; source: string; collectedAt: string; transformation: string; redactionStatus: "redacted" | "raw"; contentHash: string; expiresAt: string; deletedAt?: string };
export type LedgerEntry = { id: string; workspaceId: string; attemptId: string; ancestryHash: string; integrityHash: string; timestamp: string; redactionStatus: Evidence["redactionStatus"]; policyRef: string; decisionRef: string; outcome: string; attribution: Attribution };
export type ReplayAttempt = { id: string; workspaceId: string; originalAttemptId: string; parentAttemptId: string; ancestry: string[]; evidenceId: string; policyVersion: string; reason: string; actor: Attribution; idempotencyKey: string; status: "active" | "pending_approval" | "failed"; approvalId?: string };

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Deletable content store. The ledger never receives `content` or a reversible customer identifier. */
export class EvidenceStore {
  #items = new Map<string, Evidence>();
  put(input: Omit<Evidence, "id" | "contentHash" | "deletedAt">): Evidence {
    const item = { ...input, id: randomUUID(), contentHash: hash(input.content) };
    this.#items.set(item.id, item);
    return item;
  }
  get(id: string, workspaceId: string, now = new Date()): Evidence | undefined {
    const item = this.#items.get(id);
    return item?.workspaceId === workspaceId && !item.deletedAt && Date.parse(item.expiresAt) > now.getTime() ? item : undefined;
  }
  deleteEligible(now = new Date()): string[] {
    const deleted: string[] = [];
    for (const item of this.#items.values()) if (!item.deletedAt && Date.parse(item.expiresAt) <= now.getTime()) { item.content = ""; item.deletedAt = now.toISOString(); deleted.push(item.id); }
    return deleted;
  }
}

/** Append-only, constrained audit proof. Entries are copies so callers cannot rewrite history. */
export class AuditLedger {
  #entries: LedgerEntry[] = [];
  append(entry: Omit<LedgerEntry, "id">): LedgerEntry { const stored = Object.freeze({ ...entry, id: randomUUID() }); this.#entries.push(stored); return stored; }
  entries(workspaceId: string): LedgerEntry[] { return this.#entries.filter((entry) => entry.workspaceId === workspaceId); }
}

export class ReplayService {
  #attempts = new Map<string, ReplayAttempt>(); #keys = new Map<string, string>();
  constructor(readonly evidence: EvidenceStore, readonly ledger: AuditLedger) {}
  replay(input: { attempt: ReplayAttempt; actor: Attribution; reason: string; policyVersion: string; idempotencyKey: string; authorized: boolean; now?: Date }): ReplayAttempt {
    const key = `${input.actor.workspaceId}:${input.idempotencyKey}`; const existing = this.#keys.get(key); if (existing) return this.#attempts.get(existing)!;
    const now = input.now ?? new Date(); const original = this.#attempts.get(input.attempt.id) ?? input.attempt;
    if (original.workspaceId !== input.actor.workspaceId) throw new Error("Not found.");
    if (original.status === "active") throw new Error("Replay conflict: referenced attempt is active.");
    if (!input.authorized || Date.parse(input.actor.mfaAt) < now.getTime() - 15 * 60_000) throw new Error("Replay denied.");
    const evidence = this.evidence.get(original.evidenceId, input.actor.workspaceId, now); if (!evidence) throw new Error("Evidence is expired, deleted, or unavailable.");
    const replay: ReplayAttempt = { id: randomUUID(), workspaceId: original.workspaceId, originalAttemptId: original.originalAttemptId || original.id, parentAttemptId: original.id, ancestry: [...original.ancestry, original.id], evidenceId: evidence.id, policyVersion: input.policyVersion, reason: input.reason, actor: input.actor, idempotencyKey: input.idempotencyKey, status: "pending_approval" };
    this.#attempts.set(replay.id, replay); this.#keys.set(key, replay.id);
    this.ledger.append({ workspaceId: replay.workspaceId, attemptId: replay.id, ancestryHash: hash(replay.ancestry.join(":")), integrityHash: evidence.contentHash, timestamp: now.toISOString(), redactionStatus: evidence.redactionStatus, policyRef: replay.policyVersion, decisionRef: "approval-required", outcome: replay.status, attribution: input.actor });
    return replay;
  }
}

export type ExportManifest = { version: 1; workspaceId: string; approvedFields: Record<string, string>; artifacts: { name: string; sha256: string }[] };
export function canonicalManifest(manifest: ExportManifest): string { return JSON.stringify(manifest, Object.keys(manifest).sort()); }
export function exportHtml(manifest: ExportManifest): string { return `<html><body><script type="application/json" id="eventforge-manifest">${canonicalManifest(manifest)}</script><dl>${Object.entries(manifest.approvedFields).sort().map(([k,v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></body></html>`; }
export function verifyExport(manifest: ExportManifest, html: string, artifacts: Record<string, string>): boolean { return exportHtml(manifest) === html && manifest.artifacts.every((a) => hash(artifacts[a.name] ?? "") === a.sha256); }
