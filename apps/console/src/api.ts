const baseUrl = import.meta.env.VITE_EVENTFORGE_API_URL ?? "http://localhost:4310";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), { credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const api = {
  events: () => request<EventItem[]>("/events"),
  actions: () => request<ActionItem[]>("/actions"),
  runs: () => request<RunItem[]>("/runs"),
  audit: () => request<AuditItem[]>("/audit"),
  memory: () => request<MemoryItem[]>("/memory?q=CI"),
  connectors: () => request<ConnectorItem[]>("/connectors"),
  forges: () => request<ForgeItem[]>("/forge"),
  demo: (provider: "github" | "linear" | "sentry") => request("/events/demo", { method: "POST", body: JSON.stringify({ provider }) }),
  decideAction: (id: string, approved: boolean) => request(`/actions/${id}/decision`, { method: "POST", body: JSON.stringify({ approved, reviewer: "Jorge" }) }),
  forge: (prompt: string) => request<ForgeItem>("/forge", { method: "POST", body: JSON.stringify({ prompt }) }),
  decideForge: (id: string, approved: boolean) => request(`/forge/${id}/decision`, { method: "POST", body: JSON.stringify({ approved, reviewer: "Jorge" }) })
};

export type EventItem = { id: string; provider: string; topic: string; signatureStatus: string; receivedAt: string; payload: Record<string, unknown> };
export type ActionItem = { id: string; title: string; type: string; risk: string; status: string; diff?: string; requiredCapabilities: string[] };
export type RunItem = { id: string; status: string; summary?: string; startedAt: string; threadId?: string };
export type AuditItem = { id: string; kind: string; message: string; createdAt: string };
export type MemoryItem = { id: string; text: string; tags: string[]; createdAt: string };
export type ConnectorItem = { provider: string; status: string; capabilities: string[] };
export type ForgeItem = { id: string; prompt: string; status: string; requestedScopes: string[]; validation: { passed: boolean; findings: string[] }; generatedFiles: Array<{ path: string; content: string }> };
