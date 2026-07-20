import { createServer } from "node:net";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  if (!address || typeof address === "string") throw new Error("Unable to reserve a test port.");
  return address.port;
}

describe("self-installing EventForge MCP package", () => {
  it("starts its local control plane when configured as the only MCP package", async () => {
    const port = await availablePort();
    const client = new Client({ name: "eventforge-standalone-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/standalone.cjs")],
        env: {
          ...process.env,
          NODE_ENV: "development",
          EVENTFORGE_API_URL: `http://127.0.0.1:${port}`,
          EVENTFORGE_AUTO_START: "true",
          EVENTFORGE_CODEX_WORKDIR: process.cwd(),
          EVENTFORGE_DEMO_MODE: "true",
          EVENTFORGE_RUNNER: "demo",
        },
        stderr: "pipe",
      }),
    );
    clients.push(client);

    const emitted = await client.callTool({
      name: "emit_event",
      arguments: { provider: "custom", topic: "install.verified", payload: { source: "package" } },
    });
    const events = await client.callTool({ name: "list_events", arguments: {} });

    expect(emitted.isError).not.toBe(true);
    expect(JSON.stringify(events.content)).toContain("install.verified");
  });
});
