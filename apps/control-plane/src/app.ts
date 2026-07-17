import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import rawBody from "fastify-raw-body";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  EventForgeStore,
  ExecutionPolicySchema,
  WorkflowDefinitionSchema,
  createForgeDraft,
  demoEvents,
  isGitHubCiFailure,
  isGitHubIssueOpened,
  matchesWorkflow,
  normalizeEvent,
  policyAllowsAction,
  verifyHmac,
  type ActionProposal,
  type EventEnvelope,
  type Provider,
  type WorkflowDefinition
} from "@eventforge/core";
import { createRunner, type AgentRunner } from "./runner.js";
import { PostgresAuditSink } from "./postgres-audit.js";

const DEFAULT_WORKSPACE = "demo-workspace";
const DEFAULT_PROJECT = "eventforge-demo-service";
const LOCAL_CONSOLE_ORIGIN = "http://localhost:5173";

type AppOptions = { store?: EventForgeStore; runner?: AgentRunner; persistAudit?: boolean };

declare module "fastify" {
  interface FastifyRequest { rawBody?: string | Buffer; }
}

export function configuredBrowserOrigins(value = process.env.EVENTFORGE_ALLOWED_ORIGINS, environment = process.env.NODE_ENV): string[] {
  const origins = value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (origins.length > 0) return origins;
  if (environment === "production") throw new Error("EVENTFORGE_ALLOWED_ORIGINS must list the production console origin.");
  return [LOCAL_CONSOLE_ORIGIN];
}

export function createDefaultWorkflow(): WorkflowDefinition {
  return {
    id: randomUUID(),
    workspaceId: DEFAULT_WORKSPACE,
    projectId: DEFAULT_PROJECT,
    name: "Investigate GitHub CI failures",
    enabled: true,
    trigger: { provider: "github", topic: "check_run" },
    filters: { "check_run.conclusion": "failure" },
    agentProfile: "ci-investigator",
    memoryScope: "project",
    policy: { approvalMode: "approval_required", allowedCapabilities: ["read", "write_files", "git_commit", "provider_write"], allowedRepositories: ["eventforge/demo-service"], allowedPaths: ["src/**", "test/**"], allowedDomains: ["api.github.com"], allowedProviders: ["github"] }
  };
}

export function createIssueReviewWorkflow(): WorkflowDefinition {
  return {
    id: randomUUID(),
    workspaceId: DEFAULT_WORKSPACE,
    projectId: DEFAULT_PROJECT,
    name: "Review newly opened GitHub issues",
    enabled: true,
    trigger: { provider: "github", topic: "issues" },
    filters: { action: "opened" },
    agentProfile: "issue-triager",
    memoryScope: "project",
    policy: { approvalMode: "approval_required", allowedCapabilities: ["read"], allowedRepositories: ["tebayoso/eventforge"], allowedPaths: ["**"], allowedDomains: [], allowedProviders: ["github"] }
  };
}

function secretFor(provider: Provider): string | undefined {
  if (provider === "github") return process.env.GITHUB_WEBHOOK_SECRET;
  if (provider === "linear") return process.env.LINEAR_WEBHOOK_SECRET;
  if (provider === "sentry") return process.env.SENTRY_WEBHOOK_SECRET;
  return undefined;
}

function signatureFor(provider: Provider, headers: Record<string, unknown>): string | undefined {
  if (provider === "github") return String(headers["x-hub-signature-256"] ?? "") || undefined;
  if (provider === "linear") return String(headers["linear-signature"] ?? headers["x-linear-signature"] ?? "") || undefined;
  if (provider === "sentry") return String(headers["sentry-hook-signature"] ?? headers["x-sentry-signature"] ?? "") || undefined;
  return undefined;
}

function deliveryIdFor(provider: Provider, headers: Record<string, unknown>): string | undefined {
  if (provider === "github") return String(headers["x-github-delivery"] ?? "") || undefined;
  if (provider === "linear") return String(headers["linear-delivery"] ?? "") || undefined;
  if (provider === "sentry") return String(headers["sentry-hook-resource"] ?? "") || undefined;
  return undefined;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const store = options.store ?? new EventForgeStore();
  const runner = options.runner ?? createRunner();
  const auditSink = options.persistAudit !== false && process.env.DATABASE_URL ? new PostgresAuditSink(process.env.DATABASE_URL) : undefined;
  const allowedOrigins = configuredBrowserOrigins();
  store.addWorkflow(createDefaultWorkflow());
  store.addWorkflow(createIssueReviewWorkflow());

  await app.register(cors, {
    origin: (origin, callback) => callback(null, origin === undefined || allowedOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["content-type"],
    maxAge: 86_400
  });
  await app.register(rawBody, { global: false, encoding: false, runFirst: true });
  app.addHook("onResponse", async () => {
    if (!auditSink) return;
    const recent = store.auditEntries().slice(0, 1)[0];
    if (recent) await auditSink.append(recent).catch((error: unknown) => app.log.warn({ error }, "audit persistence failed"));
  });
  app.addHook("onClose", async () => { await auditSink?.close(); });

  async function runWorkflow(workflow: WorkflowDefinition, event: EventEnvelope): Promise<void> {
    store.audit(event.workspaceId, "workflow_matched", workflow.id, `${workflow.name} matched ${event.provider}:${event.topic}.`);
    const memories = store.memory.query(event.workspaceId, event.projectId, JSON.stringify(event.payload)).map((memory) => memory.text);
    const run = store.addRun({ id: randomUUID(), workflowId: workflow.id, eventId: event.id, status: "running", memoryIds: [], startedAt: new Date().toISOString() });
    store.audit(event.workspaceId, "agent_run", run.id, "Agent investigation started.");
    try {
      const result = await runner.investigate({ event, workflow, memories });
      store.memory.remember({ workspaceId: event.workspaceId, projectId: event.projectId, text: result.summary, tags: [event.provider, event.topic, "agent-summary"] });
      if (isGitHubIssueOpened(event)) {
        store.updateRun(run.id, { threadId: result.threadId, summary: result.summary, status: "completed", finishedAt: new Date().toISOString() });
        store.audit(event.workspaceId, "agent_run", run.id, "Read-only Codex issue review completed; no provider action was proposed.");
        return;
      }
      const capabilities = ["write_files", "git_commit", "provider_write"];
      const allowed = policyAllowsAction(workflow.policy, capabilities);
      const proposal: ActionProposal = {
        id: randomUUID(), workflowId: workflow.id, eventId: event.id,
        title: isGitHubCiFailure(event) ? "Create a remediation branch and PR proposal" : "Create a reviewed remediation proposal",
        type: isGitHubCiFailure(event) ? "open_pull_request" : "custom",
        risk: "medium", requiredCapabilities: capabilities,
        diff: "# Proposed remediation\n\n1. Reproduce the failure.\n2. Add a focused regression test.\n3. Prepare a branch and pull request after approval.",
        status: "pending", createdAt: new Date().toISOString(), auditEventIds: []
      };
      store.addAction(proposal);
      store.updateRun(run.id, { threadId: result.threadId, summary: allowed.allowed ? result.summary : `${result.summary} Policy note: ${allowed.reason}`, actionProposalId: proposal.id, status: "waiting_for_approval", finishedAt: new Date().toISOString() });
      store.audit(event.workspaceId, "agent_run", run.id, "Agent analysis completed; write proposal is waiting for approval.");
    } catch (error) {
      store.updateRun(run.id, { status: "failed", summary: error instanceof Error ? error.message : "Unknown runner failure", finishedAt: new Date().toISOString() });
      store.audit(event.workspaceId, "agent_run", run.id, "Agent investigation failed.");
    }
  }

  async function ingest(provider: Provider, payload: Record<string, unknown>, input: { signatureStatus: EventEnvelope["signatureStatus"]; deliveryId?: string; topicHint?: string; workspaceId?: string; projectId?: string; awaitWorkflows?: boolean }) {
    const event = normalizeEvent({ provider, payload, signatureStatus: input.signatureStatus, deliveryId: input.deliveryId, topicHint: input.topicHint, workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE, projectId: input.projectId ?? DEFAULT_PROJECT });
    const appended = store.appendEvent(event);
    if (!appended.created) return { duplicate: true, event: appended.event, runs: [] };
    const workflows = store.workflows(event.workspaceId).filter((workflow) => matchesWorkflow(workflow, event));
    const execution = Promise.all(workflows.map((workflow) => runWorkflow(workflow, event)));
    if (input.awaitWorkflows !== false) {
      await execution;
    } else {
      void execution.catch((error: unknown) => app.log.error({ error, eventId: event.id }, "background workflow execution failed"));
    }
    return { duplicate: false, event, runs: store.runs().filter((run) => run.eventId === event.id) };
  }

  app.get("/health", async () => ({ ok: true, service: "eventforge-control-plane", mode: process.env.EVENTFORGE_RUNNER ?? "demo" }));
  app.get("/events", async (request) => store.events((request.query as { workspaceId?: string }).workspaceId));
  app.get("/workflows", async (request) => store.workflows((request.query as { workspaceId?: string }).workspaceId));
  app.get("/runs", async () => store.runs());
  app.get("/actions", async (request) => store.actions((request.query as { workspaceId?: string }).workspaceId));
  app.get("/audit", async (request) => store.auditEntries((request.query as { workspaceId?: string }).workspaceId));
  app.get("/memory", async (request) => {
    const query = request.query as { workspaceId?: string; projectId?: string; q?: string };
    return store.memory.query(query.workspaceId ?? DEFAULT_WORKSPACE, query.projectId ?? DEFAULT_PROJECT, query.q ?? "event");
  });
  app.get("/connectors", async () => ([
    { provider: "github", status: process.env.GITHUB_WEBHOOK_SECRET ? "configured" : "demo", capabilities: ["webhook", "read", "approval-gated write"] },
    { provider: "linear", status: process.env.LINEAR_CLIENT_ID ? "configured" : "demo", capabilities: ["webhook", "read"] },
    { provider: "sentry", status: process.env.SENTRY_AUTH_TOKEN ? "configured" : "demo", capabilities: ["webhook", "read"] }
  ]));

  app.post("/workflows", async (request, reply) => {
    const parsed = WorkflowDefinitionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return reply.status(201).send(store.addWorkflow(parsed.data));
  });
  app.patch("/workflows/:id/policy", async (request, reply) => {
    const workflow = store.workflowById((request.params as { id: string }).id);
    const parsed = ExecutionPolicySchema.safeParse(request.body);
    if (!workflow) return reply.status(404).send({ error: "Workflow not found" });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    workflow.policy = parsed.data;
    return workflow;
  });

  app.post("/webhooks/:provider", { config: { rawBody: true } }, async (request, reply) => {
    const provider = z.enum(["github", "linear", "sentry", "custom"]).safeParse((request.params as { provider: string }).provider);
    if (!provider.success) return reply.status(404).send({ error: "Unknown provider" });
    const payload = request.body as Record<string, unknown>;
    if (!payload || typeof payload !== "object") return reply.status(400).send({ error: "Webhook body must be JSON." });
    const secret = secretFor(provider.data);
    const raw = request.rawBody?.toString() ?? JSON.stringify(payload);
    const isDemo = process.env.EVENTFORGE_DEMO_MODE === "true" && request.headers["x-eventforge-demo"] === "true";
    const verified = secret ? verifyHmac(raw, signatureFor(provider.data, request.headers), secret) : false;
    if (!verified && !isDemo) return reply.status(401).send({ error: "Invalid or missing webhook signature." });
    const result = await ingest(provider.data, payload, {
      signatureStatus: verified ? "verified" : "demo",
      deliveryId: deliveryIdFor(provider.data, request.headers),
      topicHint: provider.data === "github" ? String(request.headers["x-github-event"] ?? "unknown") : undefined,
      awaitWorkflows: false
    });
    return reply.status(result.duplicate ? 200 : 202).send(result);
  });

  app.post("/events/demo", async (request, reply) => {
    if (process.env.EVENTFORGE_DEMO_MODE !== "true" && process.env.NODE_ENV !== "test") return reply.status(403).send({ error: "Demo mode is disabled." });
    const provider = z.enum(["github", "linear", "sentry"]).default("github").parse((request.body as { provider?: string } | undefined)?.provider);
    const payload = provider === "github" ? demoEvents.githubCiFailure : provider === "linear" ? demoEvents.linearIssue : demoEvents.sentryIssue;
    const topicHint = provider === "github" ? "check_run" : provider === "linear" ? "create" : "created";
    return reply.status(202).send(await ingest(provider, payload, { signatureStatus: "demo", deliveryId: `demo-${provider}-${Date.now()}`, topicHint }));
  });
  app.post("/events", async (request, reply) => {
    const parsed = z.object({
      provider: z.enum(["custom", "github", "linear", "sentry"]).default("custom"),
      topic: z.string().min(1),
      payload: z.record(z.unknown()),
      workspaceId: z.string().default(DEFAULT_WORKSPACE),
      projectId: z.string().default(DEFAULT_PROJECT)
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return reply.status(202).send(await ingest(parsed.data.provider, parsed.data.payload, {
      signatureStatus: "unverified", topicHint: parsed.data.topic, workspaceId: parsed.data.workspaceId, projectId: parsed.data.projectId,
      deliveryId: `manual-${randomUUID()}`
    }));
  });
  app.post("/agent-runs", async (request, reply) => {
    const parsed = z.object({ workflowId: z.string().uuid(), eventId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const workflow = store.workflowById(parsed.data.workflowId);
    const event = store.eventById(parsed.data.eventId);
    if (!workflow || !event) return reply.status(404).send({ error: "Workflow or event not found" });
    await runWorkflow(workflow, event);
    return reply.status(202).send(store.runs().find((run) => run.eventId === event.id && run.workflowId === workflow.id));
  });

  app.post("/actions/:id/decision", async (request, reply) => {
    const parsed = z.object({ approved: z.boolean(), reviewer: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const action = store.decideAction((request.params as { id: string }).id, parsed.data.approved, parsed.data.reviewer);
    if (!action) return reply.status(404).send({ error: "Action not found" });
    return action;
  });

  app.post("/forge", async (request, reply) => {
    const parsed = z.object({ workspaceId: z.string().default(DEFAULT_WORKSPACE), prompt: z.string().min(8) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const job = store.addForge(createForgeDraft(parsed.data.workspaceId, parsed.data.prompt));
    store.audit(job.workspaceId, "forge", job.id, `Forge draft ${job.status}.`);
    return reply.status(job.status === "validated" ? 201 : 422).send(job);
  });
  app.get("/forge", async (request) => store.forgeJobs((request.query as { workspaceId?: string }).workspaceId));
  app.post("/forge/:id/decision", async (request, reply) => {
    const parsed = z.object({ approved: z.boolean(), reviewer: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const job = store.decideForge((request.params as { id: string }).id, parsed.data.approved, parsed.data.reviewer);
    if (!job) return reply.status(404).send({ error: "Forge job not found" });
    return job;
  });

  return app;
}
