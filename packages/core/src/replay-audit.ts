import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type Attribution = Readonly<{
  actorId: string;
  workspaceId: string;
  sessionId: string;
  authenticationMethod: string;
  mfaAt: string;
  requestedAt: string;
  ipHash: string;
  userAgentClass: string;
}>;

export type Evidence = Readonly<{
  id: string;
  workspaceId: string;
  content: string;
  source: string;
  collectedAt: string;
  transformation: string;
  redactionStatus: "redacted" | "raw";
  contentHash: string;
  expiresAt: string;
  deletedAt?: string;
}>;

export type EvidenceReference = Readonly<Omit<Evidence, "content">>;

export type LedgerEntry = Readonly<{
  id: string;
  workspaceId: string;
  attemptId: string;
  ancestryHash: string;
  integrityHash: string;
  timestamp: string;
  redactionStatus: Evidence["redactionStatus"];
  policyRef: string;
  decisionRef: string;
  outcome: string;
  attribution: Attribution;
}>;

export type ReplayAttempt = Readonly<{
  id: string;
  workspaceId: string;
  originalAttemptId: string;
  parentAttemptId: string;
  ancestry: readonly string[];
  evidenceId: string;
  evidenceHash?: string;
  evidenceFingerprint?: string;
  policyVersion: string;
  reason: string;
  actor: Attribution;
  idempotencyKey: string;
  status: "active" | "pending_approval" | "failed" | "approved";
  approvalId?: string;
}>;

type StoredEvidence = Evidence;

type IdempotencyRecord = Readonly<{
  attemptId: string;
  requestHash: string;
}>;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const copyAttribution = (value: Attribution): Attribution => Object.freeze({ ...value });
const copyEvidence = (value: StoredEvidence): Evidence =>
  Object.freeze({ ...value, content: value.content });
const copyAttempt = (value: ReplayAttempt): ReplayAttempt =>
  Object.freeze({
    ...value,
    ancestry: Object.freeze([...value.ancestry]),
    actor: copyAttribution(value.actor),
  });

export interface EvidenceRepository {
  readiness(): Promise<Readonly<{ durable: boolean; healthy: boolean }>>;
  read(id: string): Promise<StoredEvidence | undefined>;
  write(evidence: StoredEvidence): Promise<void>;
  list(): Promise<StoredEvidence[]>;
}

export interface ReplayAuditRepository {
  readiness(): Promise<
    Readonly<{ atomicReplayAudit: boolean; durable: boolean; healthy: boolean }>
  >;
  append(entry: LedgerEntry): Promise<void>;
  list(workspaceId: string): Promise<LedgerEntry[]>;
}

type ReplayCommitResult =
  | Readonly<{ status: "created"; attempt: ReplayAttempt }>
  | Readonly<{ status: "existing"; attempt: ReplayAttempt }>
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "rejected" }>;

export type ReplayCommitGuard = Readonly<{
  action: "replay" | "approve";
  actor: Attribution;
  attemptId: string;
  commitBefore: string;
  evidenceFingerprint: string;
  evidenceId: string;
  expectedAttemptStatus: ReplayAttempt["status"];
  policyVersion: string;
  workspaceId: string;
}>;

export interface ReplayRepository extends ReplayAuditRepository {
  readAttempt(id: string): Promise<ReplayAttempt | undefined>;
  readIdempotency(key: string): Promise<IdempotencyRecord | undefined>;
  /**
   * Durable implementations must revalidate the guard at commit time in the same transaction or
   * authoritative snapshot that writes the replay, idempotency binding, and audit entry.
   */
  createReplay(input: {
    attempt: ReplayAttempt;
    key: string;
    requestHash: string;
    ledgerEntry: LedgerEntry;
    guard: ReplayCommitGuard;
  }): Promise<ReplayCommitResult>;
  /**
   * Durable implementations must revalidate the guard and compare pending status, policy, and
   * evidence against current persisted state in the same transaction that writes approval/audit.
   */
  approvePending(input: {
    attempt: ReplayAttempt;
    expectedEvidenceFingerprint: string;
    expectedPolicyVersion: string;
    guard: ReplayCommitGuard;
    ledgerEntry: LedgerEntry;
  }): Promise<boolean>;
}

/** Explicitly ephemeral adapter for local tests and demos. Never use it as hosted storage. */
export class InMemoryEvidenceRepository implements EvidenceRepository {
  readonly #items = new Map<string, StoredEvidence>();

  async readiness(): Promise<Readonly<{ durable: boolean; healthy: boolean }>> {
    return { durable: false, healthy: true };
  }

  async read(id: string): Promise<StoredEvidence | undefined> {
    return this.#items.get(id);
  }

  async write(evidence: StoredEvidence): Promise<void> {
    this.#items.set(evidence.id, copyEvidence(evidence));
  }

  async list(): Promise<StoredEvidence[]> {
    return [...this.#items.values()];
  }
}

/** Explicitly ephemeral adapter for local tests and demos. Never use it as hosted storage. */
export class InMemoryReplayRepository implements ReplayRepository {
  readonly #attempts = new Map<string, ReplayAttempt>();
  readonly #keys = new Map<string, IdempotencyRecord>();
  readonly #entries: LedgerEntry[] = [];

  constructor(private readonly validateGuard: (guard: ReplayCommitGuard) => Promise<boolean>) {}

  async readiness(): Promise<
    Readonly<{ atomicReplayAudit: boolean; durable: boolean; healthy: boolean }>
  > {
    return { atomicReplayAudit: true, durable: false, healthy: true };
  }

  seed(attempt: ReplayAttempt): void {
    if (this.#attempts.has(attempt.id)) throw new Error("Replay attempt already exists.");
    this.#attempts.set(attempt.id, copyAttempt(attempt));
  }

  async readAttempt(id: string): Promise<ReplayAttempt | undefined> {
    return this.#attempts.get(id);
  }

  async readIdempotency(key: string): Promise<IdempotencyRecord | undefined> {
    return this.#keys.get(key);
  }

  async append(entry: LedgerEntry): Promise<void> {
    this.#entries.push(entry);
  }

  async list(workspaceId: string): Promise<LedgerEntry[]> {
    return this.#entries.filter((entry) => entry.workspaceId === workspaceId);
  }

  async createReplay(input: {
    attempt: ReplayAttempt;
    key: string;
    requestHash: string;
    ledgerEntry: LedgerEntry;
    guard: ReplayCommitGuard;
  }): Promise<ReplayCommitResult> {
    const existing = this.#keys.get(input.key);
    if (existing) {
      if (existing.requestHash !== input.requestHash) return { status: "conflict" };
      const attempt = this.#attempts.get(existing.attemptId);
      if (!attempt) throw new Error("Replay state is unavailable.");
      return { status: "existing", attempt: copyAttempt(attempt) };
    }
    const parentBeforeValidation = this.#attempts.get(input.guard.attemptId);
    if (
      !parentBeforeValidation ||
      parentBeforeValidation.workspaceId !== input.guard.workspaceId ||
      parentBeforeValidation.status !== input.guard.expectedAttemptStatus ||
      !(await this.validateGuard(input.guard))
    ) {
      return { status: "rejected" };
    }
    const parentAtCommit = this.#attempts.get(input.guard.attemptId);
    if (
      !parentAtCommit ||
      parentAtCommit.workspaceId !== input.guard.workspaceId ||
      parentAtCommit.status !== input.guard.expectedAttemptStatus
    ) {
      return { status: "rejected" };
    }
    this.#attempts.set(input.attempt.id, copyAttempt(input.attempt));
    this.#keys.set(
      input.key,
      Object.freeze({ attemptId: input.attempt.id, requestHash: input.requestHash }),
    );
    this.#entries.push(input.ledgerEntry);
    return { status: "created", attempt: copyAttempt(input.attempt) };
  }

  async approvePending(input: {
    attempt: ReplayAttempt;
    expectedEvidenceFingerprint: string;
    expectedPolicyVersion: string;
    guard: ReplayCommitGuard;
    ledgerEntry: LedgerEntry;
  }): Promise<boolean> {
    const currentBeforeValidation = this.#attempts.get(input.attempt.id);
    if (
      !currentBeforeValidation ||
      currentBeforeValidation.status !== "pending_approval" ||
      currentBeforeValidation.evidenceFingerprint !== input.expectedEvidenceFingerprint ||
      currentBeforeValidation.policyVersion !== input.expectedPolicyVersion ||
      !(await this.validateGuard(input.guard))
    ) {
      return false;
    }
    const current = this.#attempts.get(input.attempt.id);
    if (
      !current ||
      current.status !== "pending_approval" ||
      current.evidenceFingerprint !== input.expectedEvidenceFingerprint ||
      current.policyVersion !== input.expectedPolicyVersion
    ) {
      return false;
    }
    this.#attempts.set(input.attempt.id, copyAttempt(input.attempt));
    this.#entries.push(input.ledgerEntry);
    return true;
  }
}

/** Deletable content store. The ledger never receives content or reversible customer identifiers. */
export class EvidenceStore {
  constructor(
    readonly repository: EvidenceRepository,
    readonly clock: ReplayClock = systemClock,
  ) {}

  async put(input: Omit<Evidence, "id" | "contentHash" | "deletedAt">): Promise<Evidence> {
    const storedAt = this.clock.now().getTime();
    const collectedAt = Date.parse(input.collectedAt);
    const expiresAt = Date.parse(input.expiresAt);
    if (
      !Number.isFinite(collectedAt) ||
      collectedAt > storedAt ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= storedAt ||
      expiresAt > storedAt + 14 * 24 * 60 * 60_000
    ) {
      throw new Error("Evidence retention is invalid.");
    }
    const item = copyEvidence({
      ...input,
      id: randomUUID(),
      contentHash: hash(input.content),
    });
    await this.repository.write(item);
    return copyEvidence(item);
  }

  async reference(
    id: string,
    workspaceId: string,
    now = this.clock.now(),
  ): Promise<EvidenceReference | undefined> {
    const item = await this.repository.read(id);
    const expiresAt = item ? Date.parse(item.expiresAt) : Number.NaN;
    if (
      item?.workspaceId !== workspaceId ||
      item.deletedAt ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now.getTime() ||
      hash(item.content) !== item.contentHash
    ) {
      return undefined;
    }
    return Object.freeze({
      id: item.id,
      workspaceId: item.workspaceId,
      source: item.source,
      collectedAt: item.collectedAt,
      transformation: item.transformation,
      redactionStatus: item.redactionStatus,
      contentHash: item.contentHash,
      expiresAt: item.expiresAt,
      deletedAt: item.deletedAt,
    });
  }

  async deleteEligible(now = this.clock.now()): Promise<string[]> {
    const deleted: string[] = [];
    for (const item of await this.repository.list()) {
      const expiresAt = Date.parse(item.expiresAt);
      if (!item.deletedAt && (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())) {
        await this.repository.write(
          copyEvidence({ ...item, content: "", deletedAt: now.toISOString() }),
        );
        deleted.push(item.id);
      }
    }
    return deleted;
  }
}

/** Append-only constrained proof. Entries are copied and frozen before persistence. */
export class AuditLedger {
  constructor(readonly repository: ReplayAuditRepository) {}

  async append(entry: Omit<LedgerEntry, "id">): Promise<LedgerEntry> {
    const stored = this.prepare(entry);
    await this.repository.append(stored);
    return stored;
  }

  prepare(entry: Omit<LedgerEntry, "id">): LedgerEntry {
    return Object.freeze({
      ...entry,
      attribution: copyAttribution(entry.attribution),
      id: randomUUID(),
    });
  }

  async entries(workspaceId: string): Promise<LedgerEntry[]> {
    return (await this.repository.list(workspaceId)).map((entry) =>
      Object.freeze({ ...entry, attribution: copyAttribution(entry.attribution) }),
    );
  }
}

export type ReplayLaunchGate = Readonly<{
  authorizationOperational: boolean;
  auditOperational: boolean;
  allowEphemeralForTesting?: boolean;
}>;

export interface ReplayClock {
  now(): Date;
}

export interface ReplayAuthorization {
  canReplay(actor: Attribution, attempt: ReplayAttempt): Promise<boolean>;
  canApprove(actor: Attribution, attempt: ReplayAttempt): Promise<boolean>;
}

export interface ReplayPolicyAuthority {
  currentVersion(workspaceId: string): Promise<string>;
}

const systemClock: ReplayClock = { now: () => new Date() };

export class ReplayService {
  constructor(
    readonly evidence: EvidenceStore,
    readonly ledger: AuditLedger,
    readonly repository: ReplayRepository,
    readonly gate: ReplayLaunchGate,
    readonly authorization: ReplayAuthorization,
    readonly policy: ReplayPolicyAuthority,
    readonly clock: ReplayClock = systemClock,
  ) {}

  async replay(input: {
    attemptId: string;
    actor: Attribution;
    reason: string;
    idempotencyKey: string;
  }): Promise<ReplayAttempt> {
    await this.assertOperational();
    const reason = input.reason.trim();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!reason || !idempotencyKey) throw new Error("Replay denied.");
    const now = this.clock.now();
    const original = await this.repository.readAttempt(input.attemptId);
    if (!original || original.workspaceId !== input.actor.workspaceId)
      throw new Error("Not found.");
    if (
      !(await this.authorization.canReplay(input.actor, original)) ||
      !hasRecentMfa(input.actor.mfaAt, now)
    ) {
      throw new Error("Replay denied.");
    }

    const policyVersion = await this.policy.currentVersion(input.actor.workspaceId);
    if (!policyVersion) throw new Error("Replay denied.");
    const key = `${input.actor.workspaceId}:${idempotencyKey}`;
    const requestHash = hash(
      JSON.stringify({
        actorId: input.actor.actorId,
        attemptId: input.attemptId,
        policyVersion,
        reason,
        sessionId: input.actor.sessionId,
      }),
    );
    const existing = await this.repository.readIdempotency(key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error("Idempotency key conflicts with a different replay request.");
      }
      const replay = await this.repository.readAttempt(existing.attemptId);
      if (!replay) throw new Error("Replay state is unavailable.");
      return copyAttempt(replay);
    }

    if (original.status === "active") {
      throw new Error("Replay conflict: referenced attempt is active.");
    }
    const evidence = await this.evidence.reference(
      original.evidenceId,
      input.actor.workspaceId,
      now,
    );
    if (!evidence) throw new Error("Evidence is expired, deleted, or unavailable.");
    const currentEvidenceFingerprint = fingerprintEvidence(evidence);

    const replay = copyAttempt({
      id: randomUUID(),
      workspaceId: original.workspaceId,
      originalAttemptId: original.originalAttemptId || original.id,
      parentAttemptId: original.id,
      ancestry: [...original.ancestry, original.id],
      evidenceId: evidence.id,
      evidenceHash: evidence.contentHash,
      evidenceFingerprint: currentEvidenceFingerprint,
      policyVersion,
      reason,
      actor: input.actor,
      idempotencyKey,
      status: "pending_approval",
    });
    const ledgerEntry = this.ledger.prepare({
      workspaceId: replay.workspaceId,
      attemptId: replay.id,
      ancestryHash: hash(JSON.stringify(replay.ancestry)),
      integrityHash: currentEvidenceFingerprint,
      timestamp: now.toISOString(),
      redactionStatus: evidence.redactionStatus,
      policyRef: replay.policyVersion,
      decisionRef: "approval-required",
      outcome: replay.status,
      attribution: input.actor,
    });
    const committed = await this.repository.createReplay({
      attempt: replay,
      key,
      requestHash,
      ledgerEntry,
      guard: {
        action: "replay",
        actor: input.actor,
        attemptId: original.id,
        commitBefore: commitDeadline(input.actor.mfaAt, evidence.expiresAt),
        evidenceFingerprint: currentEvidenceFingerprint,
        evidenceId: evidence.id,
        expectedAttemptStatus: original.status,
        policyVersion,
        workspaceId: original.workspaceId,
      },
    });
    if (committed.status === "conflict") {
      throw new Error("Idempotency key conflicts with a different replay request.");
    }
    if (committed.status === "rejected") {
      throw new Error("Replay denied because authoritative state changed.");
    }
    return copyAttempt(committed.attempt);
  }

  async approve(input: {
    attemptId: string;
    workspaceId: string;
    approvalId: string;
    actor: Attribution;
  }): Promise<ReplayAttempt> {
    await this.assertOperational();
    const now = this.clock.now();
    const approvalId = input.approvalId.trim();
    if (!approvalId) throw new Error("Approval denied.");
    const attempt = await this.repository.readAttempt(input.attemptId);
    if (!attempt || attempt.workspaceId !== input.workspaceId) throw new Error("Not found.");
    if (
      input.actor.workspaceId !== input.workspaceId ||
      !(await this.authorization.canApprove(input.actor, attempt)) ||
      !hasRecentMfa(input.actor.mfaAt, now)
    ) {
      throw new Error("Approval denied.");
    }
    if (attempt.status !== "pending_approval") throw new Error("Approval is not pending.");
    const evidence = await this.evidence.reference(attempt.evidenceId, input.workspaceId, now);
    const currentEvidenceFingerprint = evidence ? fingerprintEvidence(evidence) : "";
    const currentPolicyVersion = await this.policy.currentVersion(input.workspaceId);
    if (
      !evidence ||
      evidence.contentHash !== attempt.evidenceHash ||
      currentEvidenceFingerprint !== attempt.evidenceFingerprint ||
      currentPolicyVersion !== attempt.policyVersion
    ) {
      throw new Error("Approval is stale because policy or evidence changed.");
    }
    const approved = copyAttempt({ ...attempt, status: "approved", approvalId });
    const ledgerEntry = this.ledger.prepare({
      workspaceId: approved.workspaceId,
      attemptId: approved.id,
      ancestryHash: hash(JSON.stringify(approved.ancestry)),
      integrityHash: currentEvidenceFingerprint,
      timestamp: now.toISOString(),
      redactionStatus: evidence.redactionStatus,
      policyRef: approved.policyVersion,
      decisionRef: approvalId,
      outcome: approved.status,
      attribution: input.actor,
    });
    if (
      !(await this.repository.approvePending({
        attempt: approved,
        expectedEvidenceFingerprint: currentEvidenceFingerprint,
        expectedPolicyVersion: currentPolicyVersion,
        guard: {
          action: "approve",
          actor: input.actor,
          attemptId: attempt.id,
          commitBefore: commitDeadline(input.actor.mfaAt, evidence.expiresAt),
          evidenceFingerprint: currentEvidenceFingerprint,
          evidenceId: evidence.id,
          expectedAttemptStatus: "pending_approval",
          policyVersion: currentPolicyVersion,
          workspaceId: attempt.workspaceId,
        },
        ledgerEntry,
      }))
    ) {
      throw new Error("Approval changed concurrently.");
    }
    return approved;
  }

  private async assertOperational(): Promise<void> {
    const [evidenceReadiness, replayReadiness] = await Promise.all([
      this.evidence.repository.readiness(),
      this.repository.readiness(),
    ]);
    const persistenceOperational =
      this.ledger.repository === this.repository &&
      evidenceReadiness.durable &&
      evidenceReadiness.healthy &&
      replayReadiness.atomicReplayAudit &&
      replayReadiness.durable &&
      replayReadiness.healthy;
    const ephemeralTestingAllowed =
      this.gate.allowEphemeralForTesting === true && process.env.NODE_ENV === "test";
    if (
      !this.gate.authorizationOperational ||
      !this.gate.auditOperational ||
      (!persistenceOperational && !ephemeralTestingAllowed)
    ) {
      throw new Error("Replay unavailable: launch gates are closed.");
    }
  }
}

function hasRecentMfa(mfaAt: string, now: Date): boolean {
  const timestamp = Date.parse(mfaAt);
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now.getTime() &&
    timestamp >= now.getTime() - 15 * 60_000
  );
}

function commitDeadline(mfaAt: string, evidenceExpiresAt: string): string {
  return new Date(
    Math.min(Date.parse(mfaAt) + 15 * 60_000, Date.parse(evidenceExpiresAt)),
  ).toISOString();
}

export function fingerprintEvidence(evidence: EvidenceReference): string {
  return hash(
    stableJson({
      collectedAt: evidence.collectedAt,
      contentHash: evidence.contentHash,
      expiresAt: evidence.expiresAt,
      id: evidence.id,
      redactionStatus: evidence.redactionStatus,
      source: evidence.source,
      transformation: evidence.transformation,
      workspaceId: evidence.workspaceId,
    }),
  );
}

export type ExportManifest = Readonly<{
  version: 1;
  workspaceId: string;
  redactionStatus: "redacted";
  approvedFields: Readonly<Record<string, string>>;
  artifacts: ReadonlyArray<Readonly<{ name: string; sha256: string }>>;
}>;

export interface ExportIntegrity {
  readonly keyId: string;
  sign(payload: string): string;
  verify(payload: string, signature: string): boolean;
}

export type EvidenceExport = Readonly<{
  manifestJson: string;
  html: string;
  keyId: string;
  signature: string;
}>;

/** Keyed verifier foundation. Hosted key custody and rotation remain deployment responsibilities. */
export class HmacExportIntegrity implements ExportIntegrity {
  constructor(
    readonly keyId: string,
    private readonly secret: string,
  ) {
    if (!keyId || secret.length < 32) throw new Error("Export integrity key is invalid.");
  }

  sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  verify(payload: string, signature: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = Buffer.from(this.sign(payload), "hex");
    const actual = Buffer.from(signature, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export function canonicalManifest(manifest: ExportManifest): string {
  validateExportManifest(manifest);
  return stableJson(manifest);
}

export function exportHtml(manifest: ExportManifest): string {
  validateExportManifest(manifest);
  const fields = Object.entries(manifest.approvedFields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  const artifacts = [...manifest.artifacts]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (artifact) =>
        `<li><span>${escapeHtml(artifact.name)}</span><code>${escapeHtml(
          artifact.sha256,
        )}</code></li>`,
    )
    .join("");
  return `<html><body><script type="application/json" id="eventforge-manifest">${escapeScriptJson(
    canonicalManifest(manifest),
  )}</script><h1>Evidence export</h1><dl><dt>Workspace</dt><dd>${escapeHtml(
    manifest.workspaceId,
  )}</dd><dt>Redaction</dt><dd>${manifest.redactionStatus}</dd>${fields}</dl><ul>${artifacts}</ul></body></html>`;
}

export function createEvidenceExport(
  manifest: ExportManifest,
  integrity: ExportIntegrity,
): EvidenceExport {
  const manifestJson = canonicalManifest(manifest);
  const html = exportHtml(manifest);
  return Object.freeze({
    manifestJson,
    html,
    keyId: integrity.keyId,
    signature: integrity.sign(exportIntegrityPayload(manifestJson, html)),
  });
}

export function verifyExport(
  manifest: ExportManifest,
  exported: EvidenceExport,
  artifacts: Readonly<Record<string, string>>,
  integrity: ExportIntegrity,
): boolean {
  try {
    const manifestJson = canonicalManifest(manifest);
    const html = exportHtml(manifest);
    const expectedNames = manifest.artifacts.map((artifact) => artifact.name).sort();
    const actualNames = Object.keys(artifacts).sort();
    return (
      exported.keyId === integrity.keyId &&
      exported.manifestJson === manifestJson &&
      exported.html === html &&
      integrity.verify(
        exportIntegrityPayload(exported.manifestJson, exported.html),
        exported.signature,
      ) &&
      expectedNames.length === actualNames.length &&
      expectedNames.every((name, index) => name === actualNames[index]) &&
      manifest.artifacts.every(
        (artifact) => hash(artifacts[artifact.name] ?? "") === artifact.sha256,
      )
    );
  } catch {
    return false;
  }
}

function exportIntegrityPayload(manifestJson: string, html: string): string {
  return `${manifestJson}\n${hash(html)}`;
}

function validateExportManifest(manifest: ExportManifest): void {
  if (
    manifest.version !== 1 ||
    !manifest.workspaceId.trim() ||
    manifest.redactionStatus !== "redacted" ||
    Object.entries(manifest.approvedFields).some(
      ([key, value]) => !key.trim() || typeof value !== "string",
    )
  ) {
    throw new Error("Export manifest is invalid.");
  }
  const names = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!artifact.name || !/^[a-f0-9]{64}$/i.test(artifact.sha256) || names.has(artifact.name)) {
      throw new Error("Export manifest is invalid.");
    }
    names.add(artifact.name);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`);
    return `{${entries.join(",")}}`;
  }
  const primitive = JSON.stringify(value);
  if (primitive === undefined) throw new Error("Manifest contains an unsupported value.");
  return primitive;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
