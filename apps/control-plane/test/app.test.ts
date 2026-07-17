import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EventForgeStore } from "@eventforge/core";
import { configuredBrowserOrigins, createApp } from "../src/app.js";
import type { AgentRunner } from "../src/runner.js";

const runner: AgentRunner = {
  investigate: async () => ({ threadId: "thread-1", summary: "CI failure traced to a missing null guard." })
};

describe("control plane", () => {
  it("permits credentialed browser requests only from configured console origins", async () => {
    const previousOrigins = process.env.EVENTFORGE_ALLOWED_ORIGINS;
    process.env.EVENTFORGE_ALLOWED_ORIGINS = "https://eventforge.dev";
    try {
      const app = await createApp({ persistAudit: false });
      const allowed = await app.inject({
        method: "OPTIONS",
        url: "/events/demo",
        headers: { origin: "https://eventforge.dev", "access-control-request-method": "POST" }
      });
      const denied = await app.inject({ method: "GET", url: "/events", headers: { origin: "https://untrusted.example" } });
      expect(allowed.headers["access-control-allow-origin"]).toBe("https://eventforge.dev");
      expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
      expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
      await app.close();
    } finally {
      if (previousOrigins === undefined) delete process.env.EVENTFORGE_ALLOWED_ORIGINS;
      else process.env.EVENTFORGE_ALLOWED_ORIGINS = previousOrigins;
    }
  });

  it("refuses an implicit browser origin allowlist in production", () => {
    expect(() => configuredBrowserOrigins(undefined, "production")).toThrow("EVENTFORGE_ALLOWED_ORIGINS");
  });

  it("runs a GitHub demo event through a policy-gated proposal", async () => {
    const app = await createApp({ store: new EventForgeStore(), runner, persistAudit: false });
    const response = await app.inject({ method: "POST", url: "/events/demo", payload: { provider: "github" } });
    expect(response.statusCode).toBe(202);
    const actions = await app.inject({ method: "GET", url: "/actions" });
    expect(actions.json()[0]).toMatchObject({ status: "pending", type: "open_pull_request" });
    const decision = await app.inject({ method: "POST", url: `/actions/${actions.json()[0].id}/decision`, payload: { approved: true, reviewer: "owner@example.com" } });
    expect(decision.json()).toMatchObject({ status: "approved", reviewer: "owner@example.com" });
    await app.close();
  });

  it("rejects an unsigned live webhook", async () => {
    const app = await createApp({ persistAudit: false });
    const response = await app.inject({ method: "POST", url: "/webhooks/github", payload: { action: "check_run" } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("acknowledges a verified webhook before its Codex review finishes", async () => {
    const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
    const secret = "webhook-test-secret";
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    let finishReview: (() => void) | undefined;
    const delayedRunner: AgentRunner = {
      investigate: async () => {
        await new Promise<void>((resolve) => { finishReview = resolve; });
        return { threadId: "thread-webhook", summary: "Issue review completed." };
      }
    };
    const app = await createApp({ store: new EventForgeStore(), runner: delayedRunner, persistAudit: false });
    const payload = JSON.stringify({ action: "opened", issue: { number: 7, title: "Acknowledge first" }, repository: { full_name: "tebayoso/eventforge" } });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    try {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        payload,
        headers: { "content-type": "application/json", "x-github-delivery": "delivery-7", "x-github-event": "issues", "x-hub-signature-256": signature }
      });
      expect(response.statusCode).toBe(202);
      expect((await app.inject({ method: "GET", url: "/runs" })).json()[0]).toMatchObject({ status: "running" });
      finishReview?.();
      await new Promise((resolve) => setImmediate(resolve));
      expect((await app.inject({ method: "GET", url: "/runs" })).json()[0]).toMatchObject({ threadId: "thread-webhook", status: "completed" });
    } finally {
      if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
      else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
      await app.close();
    }
  });

  it("starts a read-only Codex review thread for a newly opened GitHub issue", async () => {
    const app = await createApp({ store: new EventForgeStore(), runner, persistAudit: false });
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        provider: "github",
        topic: "issues",
        payload: { action: "opened", issue: { number: 42, title: "Review webhook issue flow" }, repository: { full_name: "tebayoso/eventforge" } }
      }
    });
    expect(response.statusCode).toBe(202);
    const runs = await app.inject({ method: "GET", url: "/runs" });
    expect(runs.json()[0]).toMatchObject({ threadId: "thread-1", status: "completed" });
    const actions = await app.inject({ method: "GET", url: "/actions" });
    expect(actions.json()).toEqual([]);
    await app.close();
  });

  it("creates a reviewable forge artifact rather than installing it", async () => {
    const app = await createApp({ persistAudit: false });
    const response = await app.inject({ method: "POST", url: "/forge", payload: { prompt: "Connect Linear to GitHub and create a pull request only after approval" } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "validated" });
    await app.close();
  });
});
