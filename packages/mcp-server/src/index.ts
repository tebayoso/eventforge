#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EventForgeApi } from "./client.js";

const api = new EventForgeApi();
const server = new McpServer({ name: "eventforge", version: "0.1.0" });
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.tool("listen_for_webhook", "Return a verified provider webhook endpoint and installation guidance. Provider credentials are never returned.", { provider: z.enum(["github", "linear", "sentry"]) }, async ({ provider }) => {
  const baseUrl = process.env.EVENTFORGE_PUBLIC_URL ?? api.baseUrl;
  return json({ provider, endpoint: `${baseUrl.replace(/\/$/, "")}/webhooks/${provider}`, verification: provider === "github" ? "HMAC SHA-256 x-hub-signature-256" : "Configure the provider signing secret in EventForge.", note: "Use the deterministic demo endpoint only for local demonstrations." });
});

server.tool("emit_event", "Add a manually supplied, untrusted event to EventForge. It can trigger only matching workflows and cannot bypass their policies.", {
  provider: z.enum(["custom", "github", "linear", "sentry"]).default("custom"),
  topic: z.string().min(1),
  payload: z.record(z.unknown()),
  workspaceId: z.string().default("demo-workspace"),
  projectId: z.string().default("eventforge-demo-service")
}, async (input) => json(await api.post("/events", input)));

server.tool("query_memory", "Search only the selected EventForge workspace/project memory scope.", {
  query: z.string().min(1),
  workspaceId: z.string().default("demo-workspace"),
  projectId: z.string().default("eventforge-demo-service")
}, async ({ query, workspaceId, projectId }) => json(await api.get(`/memory?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`)));

server.tool("spawn_subagent", "Start an analysis-only EventForge agent run for an existing workflow/event. Any write is returned as a separate approval proposal.", {
  workflowId: z.string().uuid(),
  eventId: z.string().uuid()
}, async (input) => json(await api.post("/agent-runs", input)));

server.tool("approve_action", "Approve or reject a pending EventForge action proposal. Approval is recorded in the audit trail.", {
  actionId: z.string().uuid(),
  approved: z.boolean(),
  reviewer: z.string().min(1)
}, async ({ actionId, ...decision }) => json(await api.post(`/actions/${actionId}/decision`, decision)));

server.tool("forge_mcp", "Create a reviewable, isolated connector draft. The artifact is not installed or loaded until an owner approves it.", {
  prompt: z.string().min(8),
  workspaceId: z.string().default("demo-workspace")
}, async (input) => json(await api.post("/forge", input)));

server.tool("approve_forge", "Approve or reject a validated connector draft; approval never grants runtime capabilities beyond its reviewed manifest.", {
  forgeId: z.string().uuid(),
  approved: z.boolean(),
  reviewer: z.string().min(1)
}, async ({ forgeId, ...decision }) => json(await api.post(`/forge/${forgeId}/decision`, decision)));

server.tool("list_events", "List recent EventForge events and their signature/processing state.", { workspaceId: z.string().optional() }, async ({ workspaceId }) => json(await api.get(`/events${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`)));
server.tool("list_workflows", "List configured workflows and their execution policy.", { workspaceId: z.string().optional() }, async ({ workspaceId }) => json(await api.get(`/workflows${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`)));

await server.connect(new StdioServerTransport());
