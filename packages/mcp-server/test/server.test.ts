import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventForgeApi } from "../src/client.js";
import { createEventForgeServer, EVENTFORGE_TOOL_NAMES } from "../src/server.js";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("EventForge MCP tool registry", () => {
  it("routes every tool through its reviewed API contract", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requests.push({
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({ ok: true, path: url.pathname }), { status: 200 });
    });
    const server = createEventForgeServer(new EventForgeApi({ fetchImpl }));
    const client = new Client({ name: "eventforge-registry-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    clients.push(client);

    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [
      { name: "listen_for_webhook", arguments: { provider: "linear" } },
      { name: "emit_event", arguments: { topic: "audit.completed", payload: { safe: true } } },
      { name: "query_memory", arguments: { query: "quality" } },
      {
        name: "spawn_subagent",
        arguments: {
          workflowId: "00000000-0000-4000-8000-000000000001",
          eventId: "00000000-0000-4000-8000-000000000002",
        },
      },
      {
        name: "approve_action",
        arguments: {
          actionId: "00000000-0000-4000-8000-000000000003",
          approved: false,
        },
      },
      { name: "forge_mcp", arguments: { prompt: "Create a safe PagerDuty connector" } },
      {
        name: "approve_forge",
        arguments: {
          forgeId: "00000000-0000-4000-8000-000000000004",
          approved: false,
        },
      },
      { name: "list_events", arguments: { workspaceId: "workspace/a" } },
      { name: "list_workflows", arguments: {} },
    ];

    for (const call of toolCalls) {
      const result = await client.callTool(call);
      expect(result.isError, call.name).not.toBe(true);
    }

    expect(toolCalls.map((call) => call.name).sort()).toEqual([...EVENTFORGE_TOOL_NAMES].sort());
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/relay/ensure",
          body: { provider: "linear" },
        }),
        expect.objectContaining({ method: "POST", path: "/events" }),
        expect.objectContaining({ method: "GET", path: expect.stringContaining("/memory?") }),
        expect.objectContaining({ method: "POST", path: "/agent-runs" }),
        expect.objectContaining({
          method: "POST",
          path: "/actions/00000000-0000-4000-8000-000000000003/decision",
          body: { approved: false },
        }),
        expect.objectContaining({ method: "POST", path: "/forge" }),
        expect.objectContaining({
          method: "POST",
          path: "/forge/00000000-0000-4000-8000-000000000004/decision",
          body: { approved: false },
        }),
        expect.objectContaining({ method: "GET", path: "/events?workspaceId=workspace%2Fa" }),
        expect.objectContaining({ method: "GET", path: "/workflows" }),
      ]),
    );
  });
});
