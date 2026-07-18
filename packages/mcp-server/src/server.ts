import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EventForgeApi } from "./client.js";

const VERSION = "0.1.0";
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const EVENTFORGE_TOOL_NAMES = [
  "listen_for_webhook",
  "emit_event",
  "query_memory",
  "spawn_subagent",
  "approve_action",
  "forge_mcp",
  "approve_forge",
  "list_events",
  "list_workflows",
] as const;

export function createEventForgeServer(api: EventForgeApi): McpServer {
  const server = new McpServer({ name: "eventforge", version: VERSION });

  server.registerTool(
    "listen_for_webhook",
    {
      description:
        "Ensure the local EventForge relay is running, then return the verified provider webhook endpoint. Managed tunnel credentials are never returned.",
      inputSchema: { provider: z.enum(["github", "linear", "sentry"]) },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ provider }) => {
      const relay = await api.post<{
        state: string;
        endpoint?: string;
        publicUrl?: string;
        tunnelName?: string;
      }>("/relay/ensure", { provider });
      return json({
        ...relay,
        provider,
        verification:
          provider === "github"
            ? "HMAC SHA-256 x-hub-signature-256"
            : "Configure the provider signing secret in EventForge.",
        note: "The relay is local and provider payloads remain subject to signature verification and workflow policy.",
      });
    },
  );

  server.registerTool(
    "emit_event",
    {
      description:
        "Add a manually supplied, untrusted event to EventForge. It can trigger only matching workflows and cannot bypass their policies.",
      inputSchema: {
        provider: z.enum(["custom", "github", "linear", "sentry"]).default("custom"),
        topic: z.string().min(1),
        payload: z.record(z.unknown()),
        workspaceId: z.string().default("demo-workspace"),
        projectId: z.string().default("eventforge-demo-service"),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => json(await api.post("/events", input)),
  );

  server.registerTool(
    "query_memory",
    {
      description: "Search only the selected EventForge workspace/project memory scope.",
      inputSchema: {
        query: z.string().min(1),
        workspaceId: z.string().default("demo-workspace"),
        projectId: z.string().default("eventforge-demo-service"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, workspaceId, projectId }) =>
      json(
        await api.get(
          `/memory?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`,
        ),
      ),
  );

  server.registerTool(
    "spawn_subagent",
    {
      description:
        "Start an analysis-only EventForge agent run for an existing workflow/event. Any write is returned as a separate approval proposal.",
      inputSchema: { workflowId: z.string().uuid(), eventId: z.string().uuid() },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => json(await api.post("/agent-runs", input)),
  );

  server.registerTool(
    "approve_action",
    {
      description:
        "Approve or reject a pending EventForge action proposal. The control plane derives reviewer identity from the authenticated session.",
      inputSchema: {
        actionId: z.string().uuid(),
        approved: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ actionId, ...decision }) =>
      json(await api.post(`/actions/${actionId}/decision`, decision)),
  );

  server.registerTool(
    "forge_mcp",
    {
      description:
        "Create a reviewable, isolated connector draft. The artifact is not installed or loaded until an owner approves it.",
      inputSchema: {
        prompt: z.string().min(8),
        workspaceId: z.string().default("demo-workspace"),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => json(await api.post("/forge", input)),
  );

  server.registerTool(
    "approve_forge",
    {
      description:
        "Approve or reject a validated connector draft. The control plane derives reviewer identity, and approval never expands its reviewed capabilities.",
      inputSchema: {
        forgeId: z.string().uuid(),
        approved: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ forgeId, ...decision }) =>
      json(await api.post(`/forge/${forgeId}/decision`, decision)),
  );

  server.registerTool(
    "list_events",
    {
      description: "List recent EventForge events and their signature/processing state.",
      inputSchema: { workspaceId: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workspaceId }) =>
      json(
        await api.get(
          `/events${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`,
        ),
      ),
  );

  server.registerTool(
    "list_workflows",
    {
      description: "List configured workflows and their execution policy.",
      inputSchema: { workspaceId: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workspaceId }) =>
      json(
        await api.get(
          `/workflows${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`,
        ),
      ),
  );

  return server;
}
