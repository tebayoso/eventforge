import { describe, expect, it } from "vitest";
import { EventForgeStore } from "@eventforge/core";
import { createApp } from "../src/app.js";
import type { AgentRunner } from "../src/runner.js";

const runner: AgentRunner = {
  investigate: async () => ({ threadId: "thread-1", summary: "CI failure traced to a missing null guard." })
};

describe("control plane", () => {
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

  it("creates a reviewable forge artifact rather than installing it", async () => {
    const app = await createApp({ persistAudit: false });
    const response = await app.inject({ method: "POST", url: "/forge", payload: { prompt: "Connect Linear to GitHub and create a pull request only after approval" } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "validated" });
    await app.close();
  });
});
