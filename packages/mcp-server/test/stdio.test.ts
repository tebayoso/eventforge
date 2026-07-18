import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { EVENTFORGE_TOOL_NAMES } from "../src/server.js";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(): Promise<Client> {
  const client = new Client({ name: "eventforge-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js")],
    env: {
      ...process.env,
      EVENTFORGE_API_URL: "http://127.0.0.1:1",
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

describe("EventForge MCP stdio protocol", () => {
  it("initializes and discovers the complete stable tool registry", async () => {
    const client = await connect();
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([...EVENTFORGE_TOOL_NAMES].sort());
  });

  it("executes a local read-only tool without contacting the control plane", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "listen_for_webhook",
      arguments: { provider: "github" },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("/webhooks/github"),
        }),
      ]),
    );
  });

  it("returns protocol validation and downstream API errors safely", async () => {
    const client = await connect();
    const invalid = await client.callTool({
      name: "listen_for_webhook",
      arguments: { provider: "unknown" },
    });
    const unavailable = await client.callTool({ name: "list_events", arguments: {} });

    expect(invalid.isError).toBe(true);
    expect(unavailable.isError).toBe(true);
    expect(JSON.stringify(unavailable.content)).not.toContain("ECONNREFUSED");
  });
});
