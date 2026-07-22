/** Deterministic, fail-closed launch controls. No record is production proof until a real adapter writes it. */
export const surfaces = ["console_api", "signed_ingress", "investigations", "evidence", "remote_mcp", "github_app"] as const;
export type Surface = (typeof surfaces)[number];
export type Result = "unknown" | "passed" | "failed" | "stale" | "skipped";
export type Evidence = { id: string; surface: Surface; result: Exclude<Result, "stale">; observedAt: number; kind: "probe" | "drill" | "reconciliation" | "upstream"; correlationId: string };
export type Gate = { surface: Surface; operationalOwner: string; decisionOwner: string; securityOwner: string; slo: string; probe: string; alertRoutes: string[]; runbook: string; dependencies: string[] };
export const launchDefaults: Record<Surface, Omit<Gate, "surface">> = {
  console_api: { operationalOwner: "console-operations", decisionOwner: "product-owner", securityOwner: "security-owner", slo: "99.9% authenticated journeys/month", probe: "authenticated synthetic tenant journey every 5m", alertRoutes: ["customer-impacting:10m", "security:immediate"], runbook: "workfiles/OPERATIONAL_READINESS.md#console-api", dependencies: ["p0-account-workspace-identity"] },
  signed_ingress: { operationalOwner: "ingress-operations", decisionOwner: "product-owner", securityOwner: "security-owner", slo: "99.9% valid signed durable acceptance/month", probe: "valid signed launch-cohort event every 5m", alertRoutes: ["customer-impacting:10m", "unsigned-ingress:immediate"], runbook: "workfiles/OPERATIONAL_READINESS.md#signed-ingress", dependencies: ["p0-durable-tenant-delivery"] },
  investigations: { operationalOwner: "delivery-operations", decisionOwner: "product-owner", securityOwner: "security-owner", slo: "99% terminal in 10m; median evidence under 2m/month", probe: "synthetic GitHub CI/check every 5m", alertRoutes: ["queue:10m", "poison:5m after retry budget"], runbook: "workfiles/OPERATIONAL_READINESS.md#investigations", dependencies: ["p0-durable-tenant-delivery"] },
  evidence: { operationalOwner: "evidence-operations", decisionOwner: "product-owner", securityOwner: "security-owner", slo: "99.9% authorized access/month", probe: "authorized synthetic export every 5m", alertRoutes: ["customer-impacting:10m", "data-integrity:immediate"], runbook: "workfiles/OPERATIONAL_READINESS.md#evidence", dependencies: ["p0-durable-replay-evidence-audit"] },
  remote_mcp: { operationalOwner: "mcp-operations", decisionOwner: "product-owner", securityOwner: "security-owner", slo: "99.5% authorized session establishment/month", probe: "OAuth synthetic session every 5m", alertRoutes: ["customer-impacting:10m", "authentication:immediate"], runbook: "workfiles/OPERATIONAL_READINESS.md#remote-mcp", dependencies: ["p0-mcp-oauth21"] },
  github_app: { operationalOwner: "github-operations", decisionOwner: "product-owner", securityOwner: "security-owner", slo: "99.9% authorized installation checks/month", probe: "synthetic installation check every 5m", alertRoutes: ["dependency:10m", "tenancy:immediate"], runbook: "workfiles/OPERATIONAL_READINESS.md#github-app", dependencies: ["p0-production-github-app"] },
};
export function withinErrorBudget(successes: number, total: number, targetPercent: number): boolean {
  return total > 0 && (successes / total) * 100 >= targetPercent;
}
export class EvidenceLedger {
  #records: Evidence[] = [];
  append(record: Evidence): Evidence { this.#records.push(Object.freeze({ ...record })); return this.#records.at(-1)!; }
  records(): readonly Evidence[] { return [...this.#records]; }
}
export function evaluateGate(gate: Gate, evidence: Evidence[], now = Date.now(), maxAgeMs = 10 * 60_000): Result {
  const related = evidence.filter((item) => item.surface === gate.surface);
  if (!related.length) return "unknown";
  if (related.some((item) => item.result === "failed" || item.result === "skipped")) return related.some((item) => item.result === "failed") ? "failed" : "skipped";
  if (related.some((item) => now - item.observedAt > maxAgeMs)) return "stale";
  return related.every((item) => item.result === "passed") ? "passed" : "unknown";
}
export function isSurfaceOpen(gate: Gate, evidence: Evidence[], upstreamDone: Record<string, boolean>, now?: number): boolean {
  return evaluateGate(gate, evidence, now) === "passed" && gate.dependencies.every((dependency) => upstreamDone[dependency]);
}
export function gaReady(gates: Gate[], evidence: Evidence[], upstreamDone: Record<string, boolean>, securityVeto: boolean, reconciliationVariance: number, criticalFinding: boolean): boolean {
  return !securityVeto && !criticalFinding && reconciliationVariance === 0 && gates.every((gate) => isSurfaceOpen(gate, evidence, upstreamDone));
}

export type Actor = { id: string; mfaAt?: number; roles: string[]; securityAuthorized?: boolean };
export type Switch = { surface: Surface; enabled: boolean; changedBy: string; changedAt: number; reason: string };
export class KillSwitches {
  #switches = new Map<Surface, Switch>();
  change(actor: Actor, surface: Surface, enabled: boolean, reason: string, now = Date.now()): Switch {
    if (!actor.roles.includes("operator") || !actor.mfaAt || now - actor.mfaAt > 15 * 60_000) throw new Error("recent MFA operator authorization required");
    if (["signed_ingress", "evidence", "remote_mcp"].includes(surface) && !actor.securityAuthorized) throw new Error("security-owner authorization required");
    const value = { surface, enabled, changedBy: actor.id, changedAt: now, reason };
    this.#switches.set(surface, value); return value;
  }
  permits(surface: Surface): boolean { return this.#switches.get(surface)?.enabled === true; }
  disposition(surface: Surface, accepted: boolean): "deny_new_work" | "drain" | "held" { return this.permits(surface) ? "drain" : accepted ? "held" : "deny_new_work"; }
}
export type Work = { id: string; workspaceId: string; state: "accepted" | "duplicate" | "retry" | "replay" | "terminal" | "dlq"; provenance: string; period: string };
export function reconcile(work: Work[]): { variance: number; nonBillable: number; byWorkspace: Record<string, number> } {
  const seen = new Set<string>(); let variance = 0; let nonBillable = 0; const byWorkspace: Record<string, number> = {};
  for (const item of work) { if (!item.provenance || seen.has(item.id)) variance++; else seen.add(item.id); if (item.state !== "terminal") nonBillable++; byWorkspace[item.workspaceId] = (byWorkspace[item.workspaceId] ?? 0) + 1; }
  return { variance, nonBillable, byWorkspace };
}
export function publicStatus(states: Partial<Record<Surface, Result>>, incident?: { summary: string; updatedAt: string }) {
  return { components: (["console_api", "signed_ingress", "investigations", "remote_mcp"] as Surface[]).map((surface) => ({ surface, state: states[surface] ?? "unknown" })), incident: incident && { summary: incident.summary.replace(/payload|tenant|stack/gi, "redacted"), updatedAt: incident.updatedAt } };
}
export function alert(category: "security_tenancy" | "customer_impact" | "data_integrity" | "queue_dlq" | "dependency" | "cost_usage" | "informational", severity: "critical" | "warning" | "info", correlationId: string, runbook: string) { return { category, severity, correlationId, runbook }; }
export function rollbackAllowed(compatibleSchema: boolean, rootCauseRecorded: boolean, attempts: number) { return { allowed: compatibleSchema, escalate: attempts > 1 && !rootCauseRecorded, preservesEvidence: true, databaseRewind: false }; }
export function restorePlan() { return { encrypted: true, tenantAware: true, rpoMinutes: 15, rtoHours: 4, isolationFirst: true, verifyIntegrity: true, verifyTenantBoundaries: true, preserveAppendOnlyAncestry: true }; }
export type Stage = "internal" | "staff_canary" | "design_partners" | "ga_review";
export function nextStage(current: Stage, healthyDays: number, partners: number, organizations: number, largeEstateAvailable: boolean, criticalBreach: boolean): Stage {
  if (criticalBreach) return current === "ga_review" ? "design_partners" : "internal";
  if (current === "internal") return "staff_canary";
  if (current === "staff_canary" && healthyDays >= 7) return "design_partners";
  if (current === "design_partners" && healthyDays >= 14 && partners >= 3 && organizations >= 2 && largeEstateAvailable) return "ga_review";
  return current;
}
