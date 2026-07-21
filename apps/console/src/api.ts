const configuredBaseUrl = import.meta.env.VITE_EVENTFORGE_API_URL;

declare global {
  interface Window {
    eventforgeDesktop?: {
      localDaemonUrl: string;
      controlPlaneUrl: string;
      platform: string;
      request: (
        path: string,
        init: { method?: string; body?: string; headers?: Record<string, string> },
      ) => Promise<{ ok: boolean; status: number; body: string }>;
    };
  }
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type JsonRecord = Record<string, unknown>;
type Parser<T> = (value: unknown) => T;

function record(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(`Invalid ${context} response.`);
  return value as JsonRecord;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ApiError(`Invalid response field: ${field}.`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : string(value, field);
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new ApiError(`Invalid response field: ${field}.`);
  return value;
}

function array<T>(parser: Parser<T>, context: string): Parser<T[]> {
  return (value) => {
    if (!Array.isArray(value)) throw new ApiError(`Invalid ${context} response.`);
    return value.map(parser);
  };
}

function baseUrl(): string {
  return configuredBaseUrl ?? window.eventforgeDesktop?.controlPlaneUrl ?? "http://127.0.0.1:4310";
}

async function request<T>(path: string, parser: Parser<T>, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    const desktop = window.eventforgeDesktop;
    if (desktop) {
      const result = await desktop.request(path, {
        method: init.method,
        body: typeof init.body === "string" ? init.body : undefined,
        headers: Object.fromEntries(headers.entries()),
      });
      response = new Response([204, 205, 304].includes(result.status) ? null : result.body, {
        status: result.status,
      });
    } else {
      response = await fetch(new URL(path, baseUrl()), {
        ...init,
        credentials: "include",
        headers,
      });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Unable to reach the EventBridge control plane.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ApiError(detail || `Request failed with status ${response.status}.`, response.status);
  }

  const body = await response.json().catch(() => {
    throw new ApiError("The control plane returned invalid JSON.", response.status);
  });
  return parser(body);
}

const parseEvent: Parser<EventItem> = (value) => {
  const item = record(value, "event");
  return {
    id: string(item.id, "event.id"),
    provider: string(item.provider, "event.provider"),
    topic: string(item.topic, "event.topic"),
    signatureStatus: string(item.signatureStatus, "event.signatureStatus"),
    receivedAt: string(item.receivedAt, "event.receivedAt"),
    payload: record(item.payload, "event.payload"),
  };
};
const parseAction: Parser<ActionItem> = (value) => {
  const item = record(value, "action");
  return {
    id: string(item.id, "action.id"),
    title: string(item.title, "action.title"),
    type: string(item.type, "action.type"),
    risk: string(item.risk, "action.risk"),
    status: string(item.status, "action.status"),
    diff: optionalString(item.diff, "action.diff"),
    requiredCapabilities: strings(item.requiredCapabilities, "action.requiredCapabilities"),
  };
};
const parseRun: Parser<RunItem> = (value) => {
  const item = record(value, "run");
  return {
    id: string(item.id, "run.id"),
    status: string(item.status, "run.status"),
    summary: optionalString(item.summary, "run.summary"),
    startedAt: string(item.startedAt, "run.startedAt"),
    threadId: optionalString(item.threadId, "run.threadId"),
  };
};
const parseAudit: Parser<AuditItem> = (value) => {
  const item = record(value, "audit entry");
  return {
    id: string(item.id, "audit.id"),
    kind: string(item.kind, "audit.kind"),
    message: string(item.message, "audit.message"),
    createdAt: string(item.createdAt, "audit.createdAt"),
  };
};
const parseMemory: Parser<MemoryItem> = (value) => {
  const item = record(value, "memory");
  return {
    id: string(item.id, "memory.id"),
    text: string(item.text, "memory.text"),
    tags: strings(item.tags, "memory.tags"),
    createdAt: string(item.createdAt, "memory.createdAt"),
  };
};
const parseConnector: Parser<ConnectorItem> = (value) => {
  const item = record(value, "connector");
  return {
    provider: string(item.provider, "connector.provider"),
    status: string(item.status, "connector.status"),
    capabilities: strings(item.capabilities, "connector.capabilities"),
  };
};
const parseForge: Parser<ForgeItem> = (value) => {
  const item = record(value, "forge job");
  const validation = record(item.validation, "forge.validation");
  if (typeof validation.passed !== "boolean")
    throw new ApiError("Invalid response field: forge.validation.passed.");
  if (!Array.isArray(item.generatedFiles))
    throw new ApiError("Invalid response field: forge.generatedFiles.");
  return {
    id: string(item.id, "forge.id"),
    prompt: string(item.prompt, "forge.prompt"),
    status: string(item.status, "forge.status"),
    requestedScopes: strings(item.requestedScopes, "forge.requestedScopes"),
    validation: {
      passed: validation.passed,
      findings: strings(validation.findings, "forge.validation.findings"),
    },
    generatedFiles: item.generatedFiles.map((value) => {
      const file = record(value, "forge file");
      return {
        path: string(file.path, "forge.file.path"),
        content: string(file.content, "forge.file.content"),
      };
    }),
  };
};

function idempotencyKey(operation: string, id: string): string {
  return `${operation}:${id}:${crypto.randomUUID()}`;
}

const passThrough = <T>(value: unknown) => value as T;

export const api = {
  events: (signal?: AbortSignal) => request("/events", array(parseEvent, "events"), { signal }),
  actions: (signal?: AbortSignal) => request("/actions", array(parseAction, "actions"), { signal }),
  runs: (signal?: AbortSignal) => request("/runs", array(parseRun, "runs"), { signal }),
  audit: (signal?: AbortSignal) => request("/audit", array(parseAudit, "audit"), { signal }),
  memory: (signal?: AbortSignal) =>
    request("/memory?q=CI", array(parseMemory, "memory"), { signal }),
  connectors: (signal?: AbortSignal) =>
    request("/connectors", array(parseConnector, "connectors"), { signal }),
  forges: (signal?: AbortSignal) => request("/forge", array(parseForge, "forge jobs"), { signal }),
  demo: (provider: "github" | "linear" | "sentry", signal?: AbortSignal) =>
    request("/events/demo", passThrough, {
      method: "POST",
      body: JSON.stringify({ provider }),
      signal,
      headers: { "Idempotency-Key": idempotencyKey("demo", provider) },
    }),
  decideAction: (id: string, approved: boolean, signal?: AbortSignal) =>
    request(`/actions/${encodeURIComponent(id)}/decision`, passThrough, {
      method: "POST",
      body: JSON.stringify({ approved }),
      signal,
      headers: { "Idempotency-Key": idempotencyKey("action", id) },
    }),
  forge: (prompt: string, signal?: AbortSignal) =>
    request("/forge", parseForge, {
      method: "POST",
      body: JSON.stringify({ prompt }),
      signal,
      headers: { "Idempotency-Key": idempotencyKey("forge", prompt) },
    }),
  decideForge: (id: string, approved: boolean, signal?: AbortSignal) =>
    request(`/forge/${encodeURIComponent(id)}/decision`, passThrough, {
      method: "POST",
      body: JSON.stringify({ approved }),
      signal,
      headers: { "Idempotency-Key": idempotencyKey("forge-decision", id) },
    }),
};

export type EventItem = {
  id: string;
  provider: string;
  topic: string;
  signatureStatus: string;
  receivedAt: string;
  payload: Record<string, unknown>;
};
export type ActionItem = {
  id: string;
  title: string;
  type: string;
  risk: string;
  status: string;
  diff?: string;
  requiredCapabilities: string[];
};
export type RunItem = {
  id: string;
  status: string;
  summary?: string;
  startedAt: string;
  threadId?: string;
};
export type AuditItem = { id: string; kind: string; message: string; createdAt: string };
export type MemoryItem = { id: string; text: string; tags: string[]; createdAt: string };
export type ConnectorItem = { provider: string; status: string; capabilities: string[] };
export type ForgeItem = {
  id: string;
  prompt: string;
  status: string;
  requestedScopes: string[];
  validation: { passed: boolean; findings: string[] };
  generatedFiles: Array<{ path: string; content: string }>;
};
