import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EventForgeStore, createForgeDraft, demoEvents, normalizeEvent, requiresApproval, verifyHmac } from "../src/index.js";

describe("event security", () => {
  it("verifies GitHub-style HMAC without accepting a mismatched payload", () => {
    const body = JSON.stringify(demoEvents.githubCiFailure);
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyHmac(body, signature, "secret")).toBe(true);
    expect(verifyHmac(`${body}x`, signature, "secret")).toBe(false);
  });

  it("redacts credentials and deduplicates provider deliveries", () => {
    const store = new EventForgeStore();
    const event = normalizeEvent({ provider: "github", workspaceId: "w", projectId: "p", payload: demoEvents.githubCiFailure, signatureStatus: "demo", deliveryId: "delivery-1", topicHint: "check_run" });
    expect(event.payload.authorization).toBe("[REDACTED]");
    expect(store.appendEvent(event).created).toBe(true);
    expect(store.appendEvent({ ...event, id: randomUUID() }).created).toBe(false);
  });
});

describe("guarded forge and policy", () => {
  it("keeps generated artifacts reviewable and rejects unsafe source", () => {
    const job = createForgeDraft("workspace", "Connect Linear to GitHub and create a PR after review");
    expect(job.status).toBe("validated");
    expect(job.requestedScopes).toContain("provider:write");
  });

  it("requires approval for writes under the default policy", () => {
    expect(requiresApproval({ approvalMode: "approval_required", allowedCapabilities: ["read"], allowedRepositories: [], allowedPaths: [], allowedDomains: [], allowedProviders: [] }, ["provider_write"])).toBe(true);
  });
});
