#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { EventForgeApi } from "./client.js";
import { createEventForgeServer } from "./server.js";

const isLoopback = (host: string) => host === "127.0.0.1" || host === "::1" || host === "localhost";

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const target = Buffer.from(expected);
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}

export async function runHttpServer(): Promise<void> {
  const host = process.env.EVENTFORGE_MCP_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.EVENTFORGE_MCP_PORT ?? "4312", 10);
  const bearerToken = process.env.EVENTFORGE_MCP_BEARER_TOKEN;

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("EVENTFORGE_MCP_PORT must be a valid TCP port.");
  }
  if (!isLoopback(host)) {
    throw new Error(
      "Remote MCP binding is disabled until EventForge OAuth 2.1 authorization is configured.",
    );
  }

  const app = createMcpExpressApp({ host });
  app.post("/mcp", async (request, response) => {
    if (bearerToken && !bearerMatches(request.headers.authorization, bearerToken)) {
      response.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }

    const server = createEventForgeServer(new EventForgeApi());
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("EventForge MCP request failed:", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });
  app.all("/mcp", (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });

  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve());
    listener.once("error", reject);
  });
  console.error(`EventForge MCP HTTP server listening on http://${host}:${port}/mcp`);
}

const entrypoint = process.argv[1];
if (
  entrypoint &&
  import.meta.url &&
  realpathSync(entrypoint) === realpathSync(fileURLToPath(import.meta.url))
) {
  runHttpServer().catch((error: unknown) => {
    console.error("EventForge MCP HTTP server failed:", error);
    process.exitCode = 1;
  });
}
