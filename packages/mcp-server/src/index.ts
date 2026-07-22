#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EventForgeApi } from "./client.js";
import { createEventForgeServer } from "./server.js";

export async function runStdioServer(api = new EventForgeApi()): Promise<void> {
  const server = createEventForgeServer(api);
  await server.connect(new StdioServerTransport());
}

const entrypoint = process.argv[1];
if (
  entrypoint &&
  import.meta.url &&
  realpathSync(entrypoint) === realpathSync(fileURLToPath(import.meta.url))
) {
  runStdioServer().catch((error: unknown) => {
    console.error("EventForge MCP server failed:", error);
    process.exitCode = 1;
  });
}

export { EventForgeApi, EventForgeApiError } from "./client.js";
export { createEventForgeServer, EVENTFORGE_TOOL_NAMES } from "./server.js";
export {
  InMemoryOAuthGrantRepository,
  OAuthAuthorizationService,
  OAuthSecurityEventSink,
  OAUTH_SCOPES,
  pkceS256,
  type FirstPartyClient,
  type IdentityAuthority,
  type OAuthGrantRepository,
  type OAuthScope,
} from "./oauth.js";
