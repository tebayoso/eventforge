import { encryptPayload, sha256, verifyHmac } from "./crypto.js";

type IngestMessage = { eventId: string; workspaceId: string; idempotencyKey: string };
type Surface = "api" | "hooks" | "preview" | "unknown";
type WaitlistPayload = {
  email?: unknown;
  source?: unknown;
  consent?: unknown;
  website?: unknown;
};

const MCP_TOOLS = [
  "listen_for_webhook",
  "emit_event",
  "query_memory",
  "spawn_subagent",
  "approve_action",
  "forge_mcp",
  "approve_forge",
  "list_events",
  "list_workflows",
].map((name) => ({
  name,
  description: `EventForge ${name.replaceAll("_", " ")} tool.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
}));

function mcpJson(id: unknown, result: unknown): Response {
  return Response.json(
    { jsonrpc: "2.0", id, result },
    { headers: { "mcp-session-id": "eventforge-demo" } },
  );
}

async function mcp(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    message = (await request.json()) as typeof message;
  } catch {
    return problem(400, "INVALID_JSON", "MCP request must be valid JSON.");
  }
  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (message.method === "initialize") {
    return mcpJson(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "eventforge", version: "0.1.0" },
      instructions:
        "Read-only demo MCP surface. Authenticate before customer-scoped operations are enabled.",
    });
  }
  if (message.method === "tools/list") return mcpJson(message.id, { tools: MCP_TOOLS });
  if (message.method === "tools/call") {
    const name = String(message.params?.name ?? "");
    if (["query_memory", "list_events", "list_workflows"].includes(name)) {
      return mcpJson(message.id, {
        content: [
          { type: "text", text: JSON.stringify({ workspaceId: "demo-workspace", items: [] }) },
        ],
      });
    }
    return Response.json(
      {
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: { code: -32001, message: "Authentication required for this operation." },
      },
      { status: 401 },
    );
  }
  return Response.json(
    {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32601, message: "Method not found." },
    },
    { status: 404 },
  );
}

export function surfaceFor(hostname: string, environment: string): Surface {
  if (environment !== "production") return "preview";
  if (hostname === "api.eventforge.dev") return "api";
  if (hostname === "hooks.eventforge.dev") return "hooks";
  return "unknown";
}

function problem(
  status: number,
  code: string,
  detail: string,
  requestId = crypto.randomUUID(),
  extraHeaders?: HeadersInit,
): Response {
  return Response.json(
    { type: "about:blank", title: code, status, code, retryable: status >= 500, detail, requestId },
    {
      status,
      headers: { "content-type": "application/problem+json", ...extraHeaders },
    },
  );
}

const WAITLIST_ORIGINS = new Set([
  "https://eventforge.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function waitlistCors(origin: string | null): HeadersInit {
  const headers: HeadersInit = { vary: "Origin" };
  if (origin && WAITLIST_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
}

export function normalizeWaitlistEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function joinWaitlist(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = waitlistCors(origin);
  if (origin && !WAITLIST_ORIGINS.has(origin))
    return problem(
      403,
      "ORIGIN_NOT_ALLOWED",
      "Waitlist submissions must originate from EventForge.",
      undefined,
      cors,
    );
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return problem(405, "METHOD_NOT_ALLOWED", "Use POST to join the waitlist.", undefined, {
      ...cors,
      allow: "POST, OPTIONS",
    });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8192)
    return problem(
      413,
      "PAYLOAD_TOO_LARGE",
      "Waitlist submissions must be smaller than 8 KB.",
      undefined,
      cors,
    );

  let payload: WaitlistPayload;
  try {
    const raw = await request.text();
    if (raw.length > 8192) throw new Error("payload too large");
    payload = JSON.parse(raw) as WaitlistPayload;
  } catch {
    return problem(400, "INVALID_JSON", "Waitlist submission must be valid JSON.", undefined, cors);
  }

  // Honeypot: pretend bot submissions succeeded without persisting them.
  if (typeof payload.website === "string" && payload.website.trim())
    return Response.json({ accepted: true }, { status: 202, headers: cors });

  const email = normalizeWaitlistEmail(payload.email);
  if (!email) return problem(400, "INVALID_EMAIL", "Enter a valid email address.", undefined, cors);
  if (payload.consent !== true)
    return problem(
      400,
      "CONSENT_REQUIRED",
      "Consent is required to join the waitlist.",
      undefined,
      cors,
    );

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimitSecret = env.WAITLIST_RATE_LIMIT_SECRET || `local-${env.ENVIRONMENT}`;
  const ipHash = await sha256(`${rateLimitSecret}:${ip}`);
  const threshold = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await env.CONTROL_DB.prepare(
    "select count(*) as count from waitlist_signups where ip_hash = ? and created_at > ?",
  )
    .bind(ipHash, threshold)
    .first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 5)
    return problem(429, "RATE_LIMITED", "Please try again later.", undefined, {
      ...cors,
      "retry-after": "3600",
    });

  const now = new Date().toISOString();
  const source =
    typeof payload.source === "string" ? payload.source.trim().slice(0, 64) || "direct" : "direct";
  const result = await env.CONTROL_DB.prepare(
    "insert into waitlist_signups (id,email,source,consent_at,ip_hash,created_at) values (?,?,?,?,?,?) on conflict(email) do nothing",
  )
    .bind(crypto.randomUUID(), email, source, now, ipHash, now)
    .run();
  return Response.json(
    { accepted: true, alreadyRegistered: Number(result.meta.changes ?? 0) === 0 },
    { status: 202, headers: cors },
  );
}

async function publishOutbox(env: Env, limit = 100): Promise<number> {
  const pending = await env.EVENTS_DB.prepare(
    "select id, payload from outbox where published_at is null order by created_at limit ?",
  )
    .bind(limit)
    .all<{ id: string; payload: string }>();
  let published = 0;
  for (const row of pending.results) {
    await env.INGEST_QUEUE.send(JSON.parse(row.payload) as IngestMessage);
    await env.EVENTS_DB.prepare(
      "update outbox set published_at = ? where id = ? and published_at is null",
    )
      .bind(new Date().toISOString(), row.id)
      .run();
    published += 1;
  }
  return published;
}

async function ingestCanary(request: Request, env: Env): Promise<Response> {
  if (String(env.PUBLIC_INGRESS_ENABLED) !== "true")
    return problem(
      503,
      "INGRESS_GATED",
      "Hosted production ingress has not passed its release gates.",
    );
  const signature = request.headers.get("x-eventforge-signature") ?? "";
  const deliveryId = request.headers.get("x-eventforge-delivery-id") ?? "";
  const topic = request.headers.get("x-eventforge-topic") ?? "canary";
  if (!deliveryId)
    return problem(400, "DELIVERY_ID_REQUIRED", "x-eventforge-delivery-id is required.");
  const raw = await request.arrayBuffer();
  if (!(await verifyHmac(raw, signature, env.CANARY_WEBHOOK_SECRET)))
    return problem(401, "INVALID_SIGNATURE", "Webhook signature verification failed.");
  const checksum = await sha256(raw);
  const idempotencyKey = `canary:${deliveryId}`;
  const existing = await env.EVENTS_DB.prepare(
    "select id from events where workspace_id = ? and idempotency_key = ?",
  )
    .bind(env.CANARY_WORKSPACE_ID, idempotencyKey)
    .first<{ id: string }>();
  if (existing) {
    await publishOutbox(env);
    return Response.json(
      { accepted: true, duplicate: true, eventId: existing.id },
      { status: 202 },
    );
  }
  const eventId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  const payloadRef = `${env.CANARY_WORKSPACE_ID}/${eventId}`;
  const encrypted = await encryptPayload(raw, env.PAYLOAD_MASTER_KEY);
  await env.PAYLOADS.put(payloadRef, encrypted.body, {
    customMetadata: { nonce: encrypted.nonce, checksum },
  });
  const now = new Date().toISOString();
  const message: IngestMessage = { eventId, workspaceId: env.CANARY_WORKSPACE_ID, idempotencyKey };
  try {
    await env.EVENTS_DB.batch([
      env.EVENTS_DB.prepare(
        "insert into events (id,workspace_id,project_id,environment_id,provider,topic,provider_delivery_id,idempotency_key,payload_ref,payload_checksum,status,occurred_at,received_at) values (?,?,?,?,? ,?,?,?,?,?,'pending',?,?)",
      ).bind(
        eventId,
        env.CANARY_WORKSPACE_ID,
        env.CANARY_PROJECT_ID,
        env.CANARY_ENVIRONMENT_ID,
        "custom",
        topic,
        deliveryId,
        idempotencyKey,
        payloadRef,
        checksum,
        now,
        now,
      ),
      env.EVENTS_DB.prepare(
        "insert into outbox (id,workspace_id,operation,idempotency_key,payload,created_at) values (?,?,?,?,?,?)",
      ).bind(
        outboxId,
        env.CANARY_WORKSPACE_ID,
        "ingest",
        idempotencyKey,
        JSON.stringify(message),
        now,
      ),
      env.EVENTS_DB.prepare(
        "insert into audit_entries (id,workspace_id,kind,subject_id,message,created_at) values (?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        env.CANARY_WORKSPACE_ID,
        "event_received",
        eventId,
        "Signed canary event durably accepted.",
        now,
      ),
    ]);
  } catch (error) {
    await env.PAYLOADS.delete(payloadRef);
    throw error;
  }
  await publishOutbox(env);
  return Response.json({ accepted: true, duplicate: false, eventId }, { status: 202 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const surface = surfaceFor(url.hostname, env.ENVIRONMENT);
    try {
      if (url.pathname === "/mcp" && url.hostname === "api.eventforge.dev") return mcp(request);
      if (surface === "unknown") return problem(404, "NOT_FOUND", "Route not found.");
      if ((surface === "api" || surface === "preview") && url.pathname === "/v1/waitlist")
        return joinWaitlist(request, env);
      if (request.method === "GET" && url.pathname === "/health")
        return Response.json({
          ok: true,
          service: "eventforge-cloud",
          environment: env.ENVIRONMENT,
          ingress: String(env.PUBLIC_INGRESS_ENABLED) === "true" ? "enabled" : "gated",
        });
      if (
        (surface === "hooks" || surface === "preview") &&
        request.method === "POST" &&
        url.pathname === "/webhooks/canary"
      )
        return ingestCanary(request, env);
      if (
        (surface === "api" || surface === "preview") &&
        (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/auth/"))
      )
        return problem(
          503,
          "AUTH_GATED",
          "Authentication and tenant repositories are not enabled yet.",
        );
      return problem(404, "NOT_FOUND", "Route not found.");
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
      return problem(500, "INTERNAL_ERROR", "The request could not be completed.");
    }
  },
  async queue(batch: MessageBatch<IngestMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await env.EVENTS_DB.prepare(
          "update events set status = 'processed' where id = ? and workspace_id = ? and status in ('pending','queued','processing')",
        )
          .bind(message.body.eventId, message.body.workspaceId)
          .run();
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "queue_failed",
            eventId: message.body.eventId,
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
        message.retry();
      }
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(publishOutbox(env));
  },
} satisfies ExportedHandler<Env, IngestMessage>;
