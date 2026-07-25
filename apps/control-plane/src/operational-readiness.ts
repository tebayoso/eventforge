/** Fail-closed launch controls. Records become production proof only through an authenticated, durable adapter. */
export const surfaces = [
  "console_api",
  "signed_ingress",
  "investigations",
  "evidence",
  "remote_mcp",
  "github_app",
] as const;
export type Surface = (typeof surfaces)[number];
export type Result = "unknown" | "passed" | "failed" | "stale" | "skipped";
export type Evidence = {
  id: string;
  workspaceId: string;
  surface: Surface;
  result: Exclude<Result, "stale">;
  observedAt: number;
  kind: "probe" | "drill" | "reconciliation" | "upstream";
  correlationId: string;
  provenance: Record<string, unknown>;
};
export type AlertRoute = { category: string; threshold: string; owner: string };
export type Gate = {
  surface: Surface;
  operationalOwner: string;
  decisionOwner: string;
  securityOwner: string;
  slo: string;
  probe: string;
  alertRoutes: AlertRoute[];
  runbook: string;
  dependencies: string[];
};

export const launchDefaults: Record<Surface, Omit<Gate, "surface">> = {
  console_api: {
    operationalOwner: "console-operations",
    decisionOwner: "product-owner",
    securityOwner: "security-owner",
    slo: "99.9% authenticated journeys/month",
    probe: "authenticated synthetic tenant journey every 5m",
    alertRoutes: [
      { category: "customer-impacting", threshold: "10m", owner: "console-operations" },
      { category: "security", threshold: "immediate", owner: "security-owner" },
    ],
    runbook: "workfiles/OPERATIONAL_READINESS.md#console-api",
    dependencies: ["p0-account-workspace-identity"],
  },
  signed_ingress: {
    operationalOwner: "ingress-operations",
    decisionOwner: "product-owner",
    securityOwner: "security-owner",
    slo: "99.9% valid signed durable acceptance/month",
    probe: "valid signed launch-cohort event every 5m",
    alertRoutes: [
      { category: "customer-impacting", threshold: "10m", owner: "ingress-operations" },
      { category: "unsigned-ingress", threshold: "immediate", owner: "security-owner" },
    ],
    runbook: "workfiles/OPERATIONAL_READINESS.md#signed-ingress",
    dependencies: ["p0-durable-tenant-delivery"],
  },
  investigations: {
    operationalOwner: "delivery-operations",
    decisionOwner: "product-owner",
    securityOwner: "security-owner",
    slo: "99% terminal in 10m; median evidence under 2m/month",
    probe: "synthetic GitHub CI/check every 5m",
    alertRoutes: [
      { category: "queue", threshold: "10m", owner: "delivery-operations" },
      { category: "poison", threshold: "5m after retry budget", owner: "delivery-operations" },
    ],
    runbook: "workfiles/OPERATIONAL_READINESS.md#investigations",
    dependencies: ["p0-durable-tenant-delivery"],
  },
  evidence: {
    operationalOwner: "evidence-operations",
    decisionOwner: "product-owner",
    securityOwner: "security-owner",
    slo: "99.9% authorized access/month",
    probe: "authorized synthetic export every 5m",
    alertRoutes: [
      { category: "customer-impacting", threshold: "10m", owner: "evidence-operations" },
      { category: "data-integrity", threshold: "immediate", owner: "security-owner" },
    ],
    runbook: "workfiles/OPERATIONAL_READINESS.md#evidence",
    dependencies: ["p0-durable-replay-evidence-audit"],
  },
  remote_mcp: {
    operationalOwner: "mcp-operations",
    decisionOwner: "product-owner",
    securityOwner: "security-owner",
    slo: "99.5% authorized session establishment/month",
    probe: "OAuth synthetic session every 5m",
    alertRoutes: [
      { category: "customer-impacting", threshold: "10m", owner: "mcp-operations" },
      { category: "authentication", threshold: "immediate", owner: "security-owner" },
    ],
    runbook: "workfiles/OPERATIONAL_READINESS.md#remote-mcp",
    dependencies: ["p0-mcp-oauth21"],
  },
  github_app: {
    operationalOwner: "github-operations",
    decisionOwner: "product-owner",
    securityOwner: "security-owner",
    slo: "99.9% authorized installation checks/month",
    probe: "synthetic installation check every 5m",
    alertRoutes: [
      { category: "dependency", threshold: "10m", owner: "github-operations" },
      { category: "tenancy", threshold: "immediate", owner: "security-owner" },
    ],
    runbook: "workfiles/OPERATIONAL_READINESS.md#github-app",
    dependencies: ["p0-production-github-app"],
  },
};

export const MAX_EVIDENCE_AGE_MS = 10 * 60_000;

export function withinErrorBudget(
  successes: number,
  total: number,
  targetPercent: number,
): boolean {
  return (
    total > 0 && successes >= 0 && successes <= total && (successes / total) * 100 >= targetPercent
  );
}

export type SwitchChange = {
  id: string;
  surface: Surface;
  enabled: boolean;
  changedBy: string;
  changedAt: number;
  reason: string;
  authorizationId: string;
  mfaVerifiedAt: number;
  securityAuthorized: boolean;
};

export interface OperationalReadinessRepository {
  appendEvidence(record: Evidence): Promise<void>;
  listEvidence(workspaceId: string): Promise<readonly Evidence[]>;
  appendSwitchChange(change: SwitchChange): Promise<void>;
  latestSwitch(surface: Surface): Promise<SwitchChange | undefined>;
  listSwitchChanges(surface: Surface): Promise<readonly SwitchChange[]>;
}

export class EvidenceLedger {
  constructor(
    private readonly repository: OperationalReadinessRepository,
    private readonly workspaceId: string,
  ) {}

  async append(record: Evidence): Promise<Evidence> {
    if (record.workspaceId !== this.workspaceId) {
      throw new Error("evidence workspace mismatch");
    }
    const immutable = Object.freeze({
      ...record,
      provenance: Object.freeze({ ...record.provenance }),
    });
    await this.repository.appendEvidence(immutable);
    return immutable;
  }

  async records(): Promise<readonly Evidence[]> {
    return this.repository.listEvidence(this.workspaceId);
  }
}

export function evaluateGate(
  gate: Gate,
  evidence: Evidence[],
  now = Date.now(),
  maxAgeMs = MAX_EVIDENCE_AGE_MS,
): Result {
  const related = evidence.filter((item) => item.surface === gate.surface);
  if (!related.length) return "unknown";
  if (related.some((item) => item.result === "failed")) return "failed";
  if (related.some((item) => item.result === "skipped")) return "skipped";
  if (related.some((item) => item.observedAt > now || now - item.observedAt > maxAgeMs)) {
    return "stale";
  }
  return related.every((item) => item.result === "passed") ? "passed" : "unknown";
}

export function isSurfaceOpen(
  gate: Gate,
  evidence: Evidence[],
  upstreamDone: Record<string, boolean>,
  now?: number,
): boolean {
  return (
    evaluateGate(gate, evidence, now) === "passed" &&
    gate.dependencies.every((dependency) => upstreamDone[dependency] === true)
  );
}

export type ReconciliationEvidence = {
  variance: number;
  evidenceId?: string;
  productionProof: boolean;
};

export function gaReady(
  gates: Gate[],
  evidence: Evidence[],
  upstreamDone: Record<string, boolean>,
  securityVeto: boolean,
  reconciliation: ReconciliationEvidence,
  criticalFinding: boolean,
  now = Date.now(),
): boolean {
  return (
    !securityVeto &&
    !criticalFinding &&
    Number.isSafeInteger(reconciliation.variance) &&
    reconciliation.variance === 0 &&
    reconciliation.productionProof &&
    Boolean(reconciliation.evidenceId) &&
    gates.every((gate) => isSurfaceOpen(gate, evidence, upstreamDone, now))
  );
}

export type OperatorAuthorization = {
  authorizationId: string;
  actorId: string;
  roles: readonly string[];
  mfaVerifiedAt: number;
  securityApprovedSurfaces: readonly Surface[];
};

/** Implementations resolve opaque authenticated session references at the trusted server boundary. */
export interface OperatorAuthorizationResolver {
  resolve(sessionReference: string): Promise<OperatorAuthorization | undefined>;
}

const MFA_MAX_AGE_MS = 15 * 60_000;
const SECURITY_OWNER_SURFACES: readonly Surface[] = ["signed_ingress", "evidence", "remote_mcp"];

export class KillSwitches {
  constructor(
    private readonly repository: OperationalReadinessRepository,
    private readonly authorizations: OperatorAuthorizationResolver,
    private readonly createId: () => string,
  ) {}

  async change(
    sessionReference: string,
    surface: Surface,
    enabled: boolean,
    reason: string,
    now = Date.now(),
  ): Promise<SwitchChange> {
    const actor = await this.authorizations.resolve(sessionReference);
    const recentMfa =
      actor !== undefined &&
      actor.mfaVerifiedAt <= now &&
      now - actor.mfaVerifiedAt <= MFA_MAX_AGE_MS;
    const securityAuthorized = actor?.securityApprovedSurfaces.includes(surface) === true;
    const securityRequirementSatisfied =
      !SECURITY_OWNER_SURFACES.includes(surface) || securityAuthorized;
    if (!actor?.roles.includes("operator") || !recentMfa || !securityRequirementSatisfied) {
      throw new Error("operator authorization denied");
    }
    if (!reason.trim()) throw new Error("kill-switch reason required");

    const value: SwitchChange = {
      id: this.createId(),
      surface,
      enabled,
      changedBy: actor.actorId,
      changedAt: now,
      reason: reason.trim(),
      authorizationId: actor.authorizationId,
      mfaVerifiedAt: actor.mfaVerifiedAt,
      securityAuthorized,
    };
    await this.repository.appendSwitchChange(value);
    return value;
  }

  async permits(surface: Surface): Promise<boolean> {
    return (await this.repository.latestSwitch(surface))?.enabled === true;
  }

  async disposition(
    surface: Surface,
    accepted: boolean,
  ): Promise<"deny_new_work" | "drain" | "held"> {
    return (await this.permits(surface)) ? "drain" : accepted ? "held" : "deny_new_work";
  }

  async history(surface: Surface): Promise<readonly SwitchChange[]> {
    return this.repository.listSwitchChanges(surface);
  }
}

export type Work = {
  id: string;
  workspaceId: string;
  state: "accepted" | "duplicate" | "retry" | "replay" | "terminal" | "dlq";
  provenance: string;
  period: string;
};
export type ReconciliationResult = {
  variance: number;
  nonBillable: number;
  byWorkspace: Record<string, number>;
  source: "provided_snapshot";
  productionProof: false;
};

export function reconcile(work: Work[]): ReconciliationResult {
  const seen = new Set<string>();
  let variance = 0;
  let nonBillable = 0;
  const byWorkspace: Record<string, number> = {};
  for (const item of work) {
    const valid =
      Boolean(item.id.trim()) &&
      Boolean(item.workspaceId.trim()) &&
      Boolean(item.provenance.trim()) &&
      Boolean(item.period.trim()) &&
      !seen.has(item.id);
    if (!valid) variance++;
    if (item.id.trim()) seen.add(item.id);
    if (item.state !== "terminal") nonBillable++;
    byWorkspace[item.workspaceId] = (byWorkspace[item.workspaceId] ?? 0) + 1;
  }
  return {
    variance,
    nonBillable,
    byWorkspace,
    source: "provided_snapshot",
    productionProof: false,
  };
}

export function publicStatus(
  states: Partial<Record<Surface, Result>>,
  incident?: { summary: string; updatedAt: string },
) {
  return {
    components: surfaces.map((surface) => ({ surface, state: states[surface] ?? "unknown" })),
    incident: incident && {
      summary: incident.summary.replace(/payload|tenant|stack/gi, "redacted"),
      updatedAt: incident.updatedAt,
    },
  };
}

export function alert(
  category:
    | "security_tenancy"
    | "customer_impact"
    | "data_integrity"
    | "queue_dlq"
    | "dependency"
    | "cost_usage"
    | "informational",
  severity: "critical" | "warning" | "info",
  correlationId: string,
  runbook: string,
  owner: string,
) {
  if (!owner.trim()) throw new Error("alert owner required");
  return { category, severity, correlationId, runbook, owner };
}

export function rollbackAllowed(input: {
  compatibleSchema: boolean;
  codeOrConfigOnly: boolean;
  knownGoodArtifact: boolean;
  evidenceRecorded: boolean;
  rootCauseRecorded: boolean;
  attempts: number;
}) {
  return {
    allowed:
      input.compatibleSchema &&
      input.codeOrConfigOnly &&
      input.knownGoodArtifact &&
      input.evidenceRecorded,
    escalate: input.attempts > 1 && !input.rootCauseRecorded,
    preservesEvidence: true,
    databaseRewind: false,
  };
}

export function restorePlan() {
  return {
    encrypted: true,
    tenantAware: true,
    rpoMinutes: 15,
    rtoHours: 4,
    isolationFirst: true,
    verifyIntegrity: true,
    verifyTenantBoundaries: true,
    preserveAppendOnlyAncestry: true,
    requiredEvidence: [
      "backup_id",
      "restore_drill_id",
      "integrity_check_id",
      "tenant_boundary_check_id",
    ],
    productionProof: false,
  } as const;
}

export type Stage = "internal" | "staff_canary" | "design_partners" | "ga_review";
export type StageObservation = {
  observedStage: Stage;
  healthyConsecutiveDays: number;
  staffCanaryParticipants: number;
  partners: number;
  organizations: number;
  largeEstateAvailable: boolean;
  criticalBreach: boolean;
  productionProof: boolean;
  evidenceIds: readonly string[];
};

export function nextStage(current: Stage, observation: StageObservation): Stage {
  if (observation.criticalBreach) return "internal";
  if (
    !observation.productionProof ||
    observation.evidenceIds.length === 0 ||
    observation.observedStage !== current
  ) {
    return current;
  }
  if (current === "internal" && observation.staffCanaryParticipants > 0) return "staff_canary";
  if (current === "staff_canary" && observation.healthyConsecutiveDays >= 7) {
    return "design_partners";
  }
  if (
    current === "design_partners" &&
    observation.healthyConsecutiveDays >= 14 &&
    observation.partners >= 3 &&
    observation.organizations >= 2 &&
    observation.largeEstateAvailable
  ) {
    return "ga_review";
  }
  return current;
}
