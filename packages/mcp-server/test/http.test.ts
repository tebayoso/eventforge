import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { EVENTFORGE_TOOL_NAMES } from "../src/server.js";

const children: ChildProcess[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  for (const child of children.splice(0)) child.kill("SIGTERM");
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

async function connectWithRetry(url: URL): Promise<Client> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const client = new Client({ name: "eventforge-http-test", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(url));
      clients.push(client);
      return client;
    } catch (error) {
      lastError = error;
      await client.close();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  throw lastError;
}

describe("EventForge Streamable HTTP transport", () => {
  it("initializes with the same stable tools as stdio", async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, [resolve("dist/http.js")], {
      env: {
        ...process.env,
        EVENTFORGE_MCP_HOST: "127.0.0.1",
        EVENTFORGE_MCP_PORT: String(port),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    children.push(child);

    const client = await connectWithRetry(new URL(`http://127.0.0.1:${port}/mcp`));
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([...EVENTFORGE_TOOL_NAMES].sort());
  });

  it("starts the local control plane when launched as the standalone HTTP package", async () => {
    const apiPort = await availablePort();
    const mcpPort = await availablePort();
    const child = spawn(process.execPath, [resolve("dist/http-standalone.cjs")], {
      env: {
        ...process.env,
        NODE_ENV: "development",
        EVENTFORGE_API_URL: `http://127.0.0.1:${apiPort}`,
        EVENTFORGE_AUTO_START: "true",
        EVENTFORGE_MCP_HOST: "127.0.0.1",
        EVENTFORGE_MCP_PORT: String(mcpPort),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    children.push(child);

    const client = await connectWithRetry(new URL(`http://127.0.0.1:${mcpPort}/mcp`));
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([...EVENTFORGE_TOOL_NAMES].sort());
  });

  it("fails closed for remote bindings even when a static bearer token is present", async () => {
    const child = spawn(process.execPath, [resolve("dist/http.js")], {
      env: {
        ...process.env,
        EVENTFORGE_MCP_HOST: "0.0.0.0",
        EVENTFORGE_MCP_PORT: "4311",
        EVENTFORGE_MCP_BEARER_TOKEN: "must-not-enable-remote-access",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const [exitCode] = (await once(child, "exit")) as [number | null];

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Remote MCP binding is disabled until EventForge OAuth 2.1");
  });
});
