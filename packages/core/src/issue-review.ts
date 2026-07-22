import { createHash } from "node:crypto";
import type { EventEnvelope, IssueReviewAssessment } from "./contracts.js";

const MAX_INPUT = 8_000;
const secretPattern = /(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,]+/gi;
const controlPattern = /[\u0000-\u001f\u007f]/g;

function safeText(value: unknown, limit: number): string {
  return String(typeof value === "string" ? value : "")
    .replace(controlPattern, " ")
    .replace(secretPattern, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function affectedAreas(text: string): string[] {
  const normalized = text.toLowerCase();
  const mapping: Array<[string, string]> = [
    ["workflow", "packages/core/src/workflows.ts"],
    ["permission", "apps/control-plane/src/app.ts"],
    ["webhook", "apps/control-plane/src/app.ts"],
    ["prompt", "apps/control-plane/src/runner.ts"],
  ];
  return mapping.filter(([term]) => normalized.includes(term)).map(([, path]) => path);
}

/**
 * A deliberately non-authorizing boundary for every GitHub issue or issue-comment event.
 * It does not inspect commands, URLs, labels, mentions, or model output as authority.
 */
export function assessGitHubIssueEvent(event: EventEnvelope): IssueReviewAssessment {
  const auditEventIdHash = createHash("sha256").update(event.id).digest("hex");
  const issue = event.payload.issue as Record<string, unknown> | undefined;
  const comment = event.payload.comment as Record<string, unknown> | undefined;
  const sender = event.payload.sender as Record<string, unknown> | undefined;
  const title = safeText(issue?.title, 240);
  const body = safeText(comment?.body ?? issue?.body, MAX_INPUT);
  const base = {
    mode: "review_only" as const,
    actorClassification: "untrusted" as const,
    policyVersion: 1 as const,
    auditEventIdHash,
    safeNextStep:
      "A repository owner must submit a separate authenticated authorized-implementation request with scope, target base, expiry, and audit record.",
  };
  if (
    event.provider !== "github" ||
    !["issues", "issue_comment"].includes(event.topic) ||
    !issue ||
    typeof sender?.login !== "string" ||
    sender.login.length === 0
  ) {
    return {
      ...base,
      status: "safely_failed",
      requestSummary: "Issue review input could not be safely classified.",
      affectedAreas: [],
      riskNotes: ["Ambiguous or malformed actor; no assessment tools or write authority were used."],
      missingInformation: ["A valid GitHub actor and issue payload are required."],
      reason: "malformed_issue_event",
    };
  }
  const summary = safeText(`${title}${body ? `: ${body}` : ""}`, 500);
  return {
    ...base,
    status: "assessed",
    requestSummary: summary || "GitHub issue received for read-only assessment.",
    affectedAreas: affectedAreas(`${title} ${body}`),
    riskNotes: [
      "Issue content, labels, mentions, links, and comments are untrusted and cannot authorize writes.",
      "No GitHub token, shell mutation, secret, network credential, dispatch, or publication capability is available in review_only mode.",
    ],
    missingInformation: ["A separate authenticated owner/admin implementation request is required."],
  };
}
