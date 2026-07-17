import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { EventEnvelope, Provider } from "./contracts.js";

const SECRET_FIELD = /(?:api[_-]?key|token|secret|password|authorization|private[_-]?key)/i;

export function verifyHmac(payload: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function redactPayload(value: unknown, path = "payload"): { value: unknown; paths: string[] } {
  if (Array.isArray(value)) {
    const paths: string[] = [];
    return {
      value: value.map((entry, index) => {
        const result = redactPayload(entry, `${path}[${index}]`);
        paths.push(...result.paths);
        return result.value;
      }),
      paths
    };
  }
  if (value && typeof value === "object") {
    const paths: string[] = [];
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD.test(key)) {
        output[key] = "[REDACTED]";
        paths.push(`${path}.${key}`);
      } else {
        const result = redactPayload(entry, `${path}.${key}`);
        output[key] = result.value;
        paths.push(...result.paths);
      }
    }
    return { value: output, paths };
  }
  return { value, paths: [] };
}

function topicFor(provider: Provider, payload: Record<string, unknown>, hint?: string): string {
  if (hint) return hint;
  if (provider === "github") return String(payload.action ?? "unknown");
  if (provider === "linear") return String(payload.action ?? payload.type ?? "unknown");
  if (provider === "sentry") return String(payload.action ?? payload.event_type ?? "issue");
  return String(payload.type ?? "custom");
}

function dedupeFor(provider: Provider, payload: Record<string, unknown>, deliveryId?: string): string {
  if (deliveryId) return `${provider}:${deliveryId}`;
  const nestedId = payload.id ?? payload.delivery_id ?? (payload.data as Record<string, unknown> | undefined)?.id;
  return `${provider}:${String(nestedId ?? JSON.stringify(payload))}`;
}

export function normalizeEvent(input: {
  provider: Provider;
  workspaceId: string;
  projectId: string;
  payload: Record<string, unknown>;
  signatureStatus: EventEnvelope["signatureStatus"];
  deliveryId?: string;
  topicHint?: string;
}): EventEnvelope {
  const redacted = redactPayload(input.payload);
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    provider: input.provider,
    topic: topicFor(input.provider, input.payload, input.topicHint),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    occurredAt: now,
    receivedAt: now,
    signatureStatus: input.signatureStatus,
    dedupeKey: dedupeFor(input.provider, input.payload, input.deliveryId),
    payload: redacted.value as Record<string, unknown>,
    redactions: redacted.paths
  };
}

export function isGitHubCiFailure(event: EventEnvelope): boolean {
  if (event.provider !== "github") return false;
  const payload = event.payload;
  const checkRun = payload.check_run as Record<string, unknown> | undefined;
  return event.topic === "check_run" && checkRun?.conclusion === "failure";
}

export function isGitHubIssueOpened(event: EventEnvelope): boolean {
  return event.provider === "github" && event.topic === "issues" && event.payload.action === "opened" && typeof event.payload.issue === "object";
}

export const demoEvents = {
  githubCiFailure: {
    action: "check_run",
    repository: { full_name: "eventforge/demo-service", default_branch: "main" },
    check_run: { id: 821, name: "test", status: "completed", conclusion: "failure", details_url: "https://github.com/eventforge/demo-service/actions/runs/821" },
    installation: { id: 10 },
    authorization: "intentionally-redacted-by-normalizer"
  },
  linearIssue: {
    action: "create",
    type: "Issue",
    data: { id: "LIN-42", title: "CI is flaky on the release branch", team: { key: "ENG" } }
  },
  sentryIssue: {
    action: "created",
    event_type: "issue",
    data: { issue: { id: "SENTRY-92", title: "TypeError in checkout", level: "error" } }
  }
} as const;
