import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuditLedger,
  EvidenceStore,
  HmacExportIntegrity,
  InMemoryEvidenceRepository,
  InMemoryReplayRepository,
  ReplayService,
  createEvidenceExport,
  exportHtml,
  fingerprintEvidence,
  verifyExport,
  type Attribution,
  type ReplayAttempt,
} from "../src/replay-audit.js";

const now = new Date("2026-07-24T12:00:00.000Z");
const actor: Attribution = {
  actorId: "operator",
  workspaceId: "w1",
  sessionId: "s",
  authenticationMethod: "passkey",
  mfaAt: now.toISOString(),
  requestedAt: now.toISOString(),
  ipHash: "ip",
  userAgentClass: "browser",
};
const clock = { now: () => now };

function createHarness(
  gate = { authorizationOperational: true, auditOperational: true },
  policyVersion = { current: "2" },
) {
  const evidenceRepository = new InMemoryEvidenceRepository();
  const evidence = new EvidenceStore(evidenceRepository, clock);
  const authorization = {
    canReplay: async () => true,
    canApprove: async () => true,
  };
  const commitHook: { current?: () => Promise<void> } = {};
  const repositoryHolder: { current?: InMemoryReplayRepository } = {};
  const replayRepository = new InMemoryReplayRepository(async (guard) => {
    const hook = commitHook.current;
    commitHook.current = undefined;
    await hook?.();
    const reference = await evidence.reference(guard.evidenceId, guard.workspaceId, clock.now());
    const authorized =
      guard.action === "replay"
        ? await authorization.canReplay(
            guard.actor,
            (await repositoryHolder.current?.readAttempt(guard.attemptId))!,
          )
        : await authorization.canApprove(
            guard.actor,
            (await repositoryHolder.current?.readAttempt(guard.attemptId))!,
          );
    return (
      authorized &&
      policyVersion.current === guard.policyVersion &&
      Date.parse(guard.commitBefore) >= clock.now().getTime() &&
      reference !== undefined &&
      fingerprintEvidence(reference) === guard.evidenceFingerprint
    );
  });
  repositoryHolder.current = replayRepository;
  const ledger = new AuditLedger(replayRepository);
  const service = new ReplayService(
    evidence,
    ledger,
    replayRepository,
    { ...gate, allowEphemeralForTesting: true },
    authorization,
    { currentVersion: async () => policyVersion.current },
    clock,
  );
  return {
    authorization,
    commitHook,
    evidence,
    evidenceRepository,
    ledger,
    policyVersion,
    replayRepository,
    service,
  };
}

async function putEvidence(harness: ReturnType<typeof createHarness>, workspaceId = "w1") {
  return harness.evidence.put({
    workspaceId,
    content: "redacted",
    source: "github",
    collectedAt: now.toISOString(),
    transformation: "none",
    redactionStatus: "redacted",
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  });
}

function originalAttempt(evidenceId: string, workspaceId = "w1"): ReplayAttempt {
  return {
    id: "original",
    workspaceId,
    originalAttemptId: "original",
    parentAttemptId: "",
    ancestry: [],
    evidenceId,
    policyVersion: "1",
    reason: "receipt",
    actor: { ...actor, workspaceId },
    idempotencyKey: "receipt",
    status: "failed",
    approvalId: "old",
  };
}

function seedOriginal(
  harness: ReturnType<typeof createHarness>,
  evidenceId: string,
  workspaceId = "w1",
): ReplayAttempt {
  const original = originalAttempt(evidenceId, workspaceId);
  harness.replayRepository.seed(original);
  return original;
}

describe("durable replay audit", () => {
  it("creates immutable linked replay without inheriting approval", async () => {
    const harness = createHarness();
    const item = await putEvidence(harness);
    const original = seedOriginal(harness, item.id);

    const replay = await harness.service.replay({
      attemptId: original.id,
      actor,
      reason: "corrected input",
      idempotencyKey: "k",
    });

    expect(replay).toMatchObject({
      originalAttemptId: "original",
      parentAttemptId: "original",
      ancestry: ["original"],
      evidenceHash: item.contentHash,
      status: "pending_approval",
    });
    expect(replay.approvalId).toBeUndefined();
    expect(original).toHaveProperty("approvalId", "old");
    expect((await harness.ledger.entries("w1"))[0]).not.toHaveProperty("content");
    expect(Object.isFrozen(replay)).toBe(true);
  });

  it("deduplicates the same request but rejects reuse for different audit context", async () => {
    const harness = createHarness();
    const original = seedOriginal(harness, (await putEvidence(harness)).id);
    const request = {
      attemptId: original.id,
      actor,
      reason: "corrected input",
      idempotencyKey: "k",
    };
    const replay = await harness.service.replay(request);

    expect((await harness.service.replay(request)).id).toBe(replay.id);
    harness.authorization.canReplay = async () => false;
    await expect(harness.service.replay(request)).rejects.toThrow("Replay denied");
    harness.authorization.canReplay = async () => true;
    harness.replayRepository.readIdempotency = async () => undefined;
    expect((await harness.service.replay(request)).id).toBe(replay.id);
    expect(await harness.ledger.entries("w1")).toHaveLength(1);
    await expect(
      harness.service.replay({ ...request, reason: "different reason" }),
    ).rejects.toThrow("Idempotency key conflicts");
  });

  it("isolates tenant lookups and refuses expired or deleted evidence", async () => {
    const harness = createHarness();
    const item = await putEvidence(harness);
    const exposed = await harness.evidence.reference(item.id, "w1");

    expect(await harness.evidence.reference(item.id, "w2")).toBeUndefined();
    const crossTenant = seedOriginal(harness, item.id, "w2");
    await expect(
      harness.service.replay({
        attemptId: crossTenant.id,
        actor: { ...actor, workspaceId: "w1" },
        reason: "cross tenant",
        idempotencyKey: "cross",
      }),
    ).rejects.toThrow("Not found");

    await harness.evidence.deleteEligible(new Date(now.getTime() + 120_000));
    expect(await harness.evidence.reference(item.id, "w1", now)).toBeUndefined();
    expect((await harness.evidenceRepository.read(item.id))?.content).toBe("");
    expect(Object.isFrozen(exposed)).toBe(true);
  });

  it("blocks stale approvals after material policy or evidence change", async () => {
    const harness = createHarness();
    const item = await putEvidence(harness);
    const original = seedOriginal(harness, item.id);
    const replay = await harness.service.replay({
      attemptId: original.id,
      actor,
      reason: "corrected input",
      idempotencyKey: "stale",
    });

    harness.policyVersion.current = "3";
    await expect(
      harness.service.approve({
        attemptId: replay.id,
        workspaceId: "w1",
        approvalId: "approval",
        actor,
      }),
    ).rejects.toThrow("Approval is stale");

    harness.policyVersion.current = "2";
    await harness.evidenceRepository.write({
      ...item,
      transformation: "materially changed",
    });
    await expect(
      harness.service.approve({
        attemptId: replay.id,
        workspaceId: "w1",
        approvalId: "approval",
        actor,
      }),
    ).rejects.toThrow("Approval is stale");

    await harness.evidenceRepository.write({
      ...item,
      content: "materially changed",
    });
    await expect(
      harness.service.approve({
        attemptId: replay.id,
        workspaceId: "w1",
        approvalId: "approval",
        actor,
      }),
    ).rejects.toThrow("Approval is stale");
  });

  it("records a fresh approval only when evidence and policy still match", async () => {
    const harness = createHarness();
    const item = await putEvidence(harness);
    const original = seedOriginal(harness, item.id);
    const replay = await harness.service.replay({
      attemptId: original.id,
      actor,
      reason: "corrected input",
      idempotencyKey: "fresh",
    });

    const approvalRequest = {
      attemptId: replay.id,
      workspaceId: "w1",
      approvalId: "fresh-approval",
      actor,
    };
    expect(await harness.service.approve(approvalRequest)).toMatchObject({
      status: "approved",
      approvalId: "fresh-approval",
    });
    await expect(
      harness.service.approve({
        attemptId: replay.id,
        workspaceId: "w1",
        approvalId: "fresh-approval",
        actor,
      }),
    ).rejects.toThrow("Approval is not pending");
  });

  it("rejects replay and approval when authority changes before atomic commit", async () => {
    const replayRace = createHarness();
    const replayEvidence = await putEvidence(replayRace);
    const original = seedOriginal(replayRace, replayEvidence.id);
    replayRace.commitHook.current = async () => {
      replayRace.policyVersion.current = "3";
    };

    await expect(
      replayRace.service.replay({
        attemptId: original.id,
        actor,
        reason: "corrected input",
        idempotencyKey: "policy-race",
      }),
    ).rejects.toThrow("authoritative state changed");
    expect(await replayRace.ledger.entries("w1")).toHaveLength(0);

    const approvalRace = createHarness();
    const approvalEvidence = await putEvidence(approvalRace);
    const approvalOriginal = seedOriginal(approvalRace, approvalEvidence.id);
    const replay = await approvalRace.service.replay({
      attemptId: approvalOriginal.id,
      actor,
      reason: "corrected input",
      idempotencyKey: "approval-race",
    });
    approvalRace.commitHook.current = async () => {
      approvalRace.authorization.canApprove = async () => false;
    };

    await expect(
      approvalRace.service.approve({
        attemptId: replay.id,
        workspaceId: "w1",
        approvalId: "approval",
        actor,
      }),
    ).rejects.toThrow("Approval changed concurrently");
    expect(await approvalRace.ledger.entries("w1")).toHaveLength(1);
  });

  it("uses a trusted clock and requires operational launch gates", async () => {
    const harness = createHarness({ authorizationOperational: false, auditOperational: true });
    const item = await putEvidence(harness);
    const original = seedOriginal(harness, item.id);
    const request = {
      attemptId: original.id,
      actor,
      reason: "corrected input",
      idempotencyKey: "gate",
    };
    await expect(harness.service.replay(request)).rejects.toThrow("launch gates are closed");

    const active = createHarness();
    const activeItem = await putEvidence(active);
    const activeOriginal = seedOriginal(active, activeItem.id);
    await expect(
      active.service.replay({
        ...request,
        attemptId: activeOriginal.id,
        actor: { ...actor, mfaAt: new Date(now.getTime() + 1).toISOString() },
      }),
    ).rejects.toThrow("Replay denied");

    const conflict = createHarness();
    const conflictItem = await putEvidence(conflict);
    const activeAttempt = {
      ...originalAttempt(conflictItem.id),
      status: "active" as const,
    };
    conflict.replayRepository.seed(activeAttempt);
    await expect(
      conflict.service.replay({
        attemptId: activeAttempt.id,
        actor,
        reason: "duplicate",
        idempotencyKey: "active",
      }),
    ).rejects.toThrow("referenced attempt is active");

    const ephemeralEvidence = new EvidenceStore(new InMemoryEvidenceRepository(), clock);
    const ephemeralRepository = new InMemoryReplayRepository(async () => true);
    const ephemeralService = new ReplayService(
      ephemeralEvidence,
      new AuditLedger(ephemeralRepository),
      ephemeralRepository,
      { authorizationOperational: true, auditOperational: true },
      {
        canReplay: async () => true,
        canApprove: async () => true,
      },
      { currentVersion: async () => "2" },
      clock,
    );
    const ephemeralItem = await ephemeralEvidence.put({
      workspaceId: "w1",
      content: "redacted",
      source: "github",
      collectedAt: now.toISOString(),
      transformation: "none",
      redactionStatus: "redacted",
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    const ephemeralOriginal = originalAttempt(ephemeralItem.id);
    ephemeralService.repository.seed(ephemeralOriginal);
    await expect(
      ephemeralService.replay({
        ...request,
        attemptId: ephemeralOriginal.id,
      }),
    ).rejects.toThrow("launch gates are closed");
  });

  it("rejects invalid or overlong evidence retention", async () => {
    const harness = createHarness();
    const base = {
      workspaceId: "w1",
      content: "redacted",
      source: "github",
      collectedAt: now.toISOString(),
      transformation: "none",
      redactionStatus: "redacted" as const,
    };

    await expect(harness.evidence.put({ ...base, expiresAt: "not-a-date" })).rejects.toThrow(
      "retention is invalid",
    );
    await expect(
      harness.evidence.put({
        ...base,
        expiresAt: new Date(now.getTime() + 15 * 24 * 60 * 60_000).toISOString(),
      }),
    ).rejects.toThrow("retention is invalid");
    await expect(
      harness.evidence.put({
        ...base,
        collectedAt: new Date(now.getTime() + 60_000).toISOString(),
        expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      }),
    ).rejects.toThrow("retention is invalid");

    const item = await harness.evidence.put({
      ...base,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    await harness.evidenceRepository.write({ ...item, expiresAt: "corrupt" });
    expect(await harness.evidence.reference(item.id, "w1")).toBeUndefined();
    expect(await harness.evidence.deleteEligible()).toContain(item.id);
  });
});

describe("evidence exports", () => {
  const integrity = new HmacExportIntegrity("test-key", "x".repeat(32));
  const artifact = "artifact body";
  const manifest = {
    version: 1 as const,
    workspaceId: "w1",
    redactionStatus: "redacted" as const,
    approvedFields: { status: "approved", unsafe: "<script>alert(1)</script>" },
    artifacts: [
      {
        name: "report.txt",
        sha256: createHash("sha256").update(artifact).digest("hex"),
      },
    ],
  };

  it("escapes human-readable fields and verifies matching signed representations", () => {
    const exported = createEvidenceExport(manifest, integrity);

    expect(exportHtml(manifest)).not.toContain("<script>alert(1)</script>");
    expect(verifyExport(manifest, exported, { "report.txt": artifact }, integrity)).toBe(true);
    expect(
      verifyExport(
        manifest,
        { ...exported, keyId: "unknown-key" },
        { "report.txt": artifact },
        integrity,
      ),
    ).toBe(false);
  });

  it("rejects modifications to either exact representation, signatures, or artifacts", () => {
    const exported = createEvidenceExport(manifest, integrity);

    expect(
      verifyExport(
        manifest,
        { ...exported, manifestJson: `${exported.manifestJson} ` },
        { "report.txt": artifact },
        integrity,
      ),
    ).toBe(false);
    expect(
      verifyExport(
        manifest,
        { ...exported, html: `${exported.html}\n` },
        { "report.txt": artifact },
        integrity,
      ),
    ).toBe(false);
    expect(
      verifyExport(
        manifest,
        { ...exported, signature: "00".repeat(32) },
        { "report.txt": artifact },
        integrity,
      ),
    ).toBe(false);
    expect(
      verifyExport(
        manifest,
        exported,
        { "report.txt": artifact, "extra.txt": artifact },
        integrity,
      ),
    ).toBe(false);
    expect(verifyExport(manifest, exported, { "report.txt": "changed" }, integrity)).toBe(false);
    expect(() =>
      createEvidenceExport(
        { ...manifest, artifacts: [manifest.artifacts[0], manifest.artifacts[0]] },
        integrity,
      ),
    ).toThrow("manifest is invalid");
    expect(() => new HmacExportIntegrity("", "short")).toThrow("integrity key is invalid");
    expect(() => createEvidenceExport({ ...manifest, workspaceId: "" }, integrity)).toThrow(
      "manifest is invalid",
    );
    expect(
      verifyExport(
        manifest,
        { ...exported, signature: "not-hex" },
        { "report.txt": artifact },
        integrity,
      ),
    ).toBe(false);
  });
});
