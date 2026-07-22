import { describe, expect, it } from "vitest";
import { AuditLedger, EvidenceStore, ReplayService, exportHtml, verifyExport } from "../src/replay-audit.js";

const actor = { actorId: "operator", workspaceId: "w1", sessionId: "s", authenticationMethod: "passkey", mfaAt: new Date().toISOString(), requestedAt: new Date().toISOString(), ipHash: "ip", userAgentClass: "browser" };
describe("durable replay audit", () => {
  it("creates immutable linked replay without inherited approval and is idempotent", () => {
    const evidence = new EvidenceStore(); const item = evidence.put({ workspaceId: "w1", content: "redacted", source: "github", collectedAt: new Date().toISOString(), transformation: "none", redactionStatus: "redacted", expiresAt: new Date(Date.now()+60_000).toISOString() }); const ledger = new AuditLedger(); const service = new ReplayService(evidence, ledger);
    const original = { id: "original", workspaceId: "w1", originalAttemptId: "original", parentAttemptId: "", ancestry: [], evidenceId: item.id, policyVersion: "1", reason: "receipt", actor, idempotencyKey: "receipt", status: "failed" as const, approvalId: "old" };
    const replay = service.replay({ attempt: original, actor, reason: "corrected input", policyVersion: "2", idempotencyKey: "k", authorized: true });
    expect(replay).toMatchObject({ originalAttemptId: "original", parentAttemptId: "original", status: "pending_approval" }); expect(replay.approvalId).toBeUndefined(); expect(service.replay({ attempt: original, actor, reason: "ignored", policyVersion: "2", idempotencyKey: "k", authorized: true }).id).toBe(replay.id); expect(ledger.entries("w1")[0]).not.toHaveProperty("content");
  });
  it("cannot replay deleted evidence and detects export mutations", () => {
    const evidence = new EvidenceStore(); const item = evidence.put({ workspaceId: "w1", content: "secret", source: "x", collectedAt: new Date().toISOString(), transformation: "none", redactionStatus: "redacted", expiresAt: new Date(0).toISOString() }); evidence.deleteEligible(); expect(evidence.get(item.id,"w1")).toBeUndefined(); const manifest = { version: 1 as const, workspaceId: "w1", approvedFields: { status: "approved" }, artifacts: [] }; const html = exportHtml(manifest); expect(verifyExport(manifest, html, {})).toBe(true); expect(verifyExport(manifest, `${html}x`, {})).toBe(false);
  });
});
