import { describe, expect, it } from "vitest";
import {
  alert,
  EvidenceLedger,
  evaluateGate,
  gaReady,
  KillSwitches,
  launchDefaults,
  nextStage,
  publicStatus,
  reconcile,
  restorePlan,
  rollbackAllowed,
  surfaces,
  withinErrorBudget,
  type Evidence,
  type Gate,
  type OperationalReadinessRepository,
  type OperatorAuthorization,
  type StageObservation,
  type Surface,
  type SwitchChange,
} from "../src/operational-readiness.js";

const now = 1_000_000;
const workspaceId = "workspace-1";
const gate = (surface: Surface = "console_api"): Gate => ({
  surface,
  ...launchDefaults[surface],
});
const passed = (
  surface: Surface = "console_api",
  result: Evidence["result"] = "passed",
): Evidence => ({
  id: `${surface}-evidence`,
  workspaceId,
  surface,
  result,
  observedAt: now,
  kind: "probe",
  correlationId: "safe-1",
  provenance: { probe: "synthetic" },
});

class MemoryRepository implements OperationalReadinessRepository {
  readonly evidence: Evidence[] = [];
  readonly switches: SwitchChange[] = [];

  async appendEvidence(record: Evidence): Promise<void> {
    this.evidence.push(record);
  }

  async listEvidence(requestedWorkspaceId: string): Promise<readonly Evidence[]> {
    return this.evidence.filter((item) => item.workspaceId === requestedWorkspaceId);
  }

  async appendSwitchChange(change: SwitchChange): Promise<void> {
    this.switches.push(change);
  }

  async latestSwitch(surface: Surface): Promise<SwitchChange | undefined> {
    return this.switches.filter((item) => item.surface === surface).at(-1);
  }

  async listSwitchChanges(surface: Surface): Promise<readonly SwitchChange[]> {
    return this.switches.filter((item) => item.surface === surface);
  }
}

const authorizedActor: OperatorAuthorization = {
  authorizationId: "authorization-1",
  actorId: "operator-1",
  roles: ["operator"],
  mfaVerifiedAt: now,
  securityApprovedSurfaces: ["signed_ingress"],
};

const stageObservation = (overrides: Partial<StageObservation> = {}): StageObservation => ({
  observedStage: "staff_canary",
  healthyConsecutiveDays: 7,
  staffCanaryParticipants: 1,
  partners: 0,
  organizations: 0,
  largeEstateAvailable: false,
  criticalBreach: false,
  productionProof: true,
  evidenceIds: ["stage-evidence-1"],
  ...overrides,
});

describe("operational readiness", () => {
  it("evaluates monthly error budgets and reloads immutable evidence after restart", async () => {
    expect(withinErrorBudget(999, 1000, 99.9)).toBe(true);
    expect(withinErrorBudget(998, 1000, 99.9)).toBe(false);
    expect(withinErrorBudget(1001, 1000, 99.9)).toBe(false);

    const repository = new MemoryRepository();
    const firstProcess = new EvidenceLedger(repository, workspaceId);
    await firstProcess.append(passed());
    const restartedProcess = new EvidenceLedger(repository, workspaceId);
    const records = await restartedProcess.records();
    expect(records).toHaveLength(1);
    expect(() => {
      records[0]!.result = "failed";
    }).toThrow();
    await expect(
      firstProcess.append({ ...passed(), workspaceId: "other-workspace" }),
    ).rejects.toThrow("evidence workspace mismatch");
  });

  it("keeps each gate independently closed for missing, stale, skipped, or failed evidence", () => {
    expect(evaluateGate(gate(), [], now)).toBe("unknown");
    expect(evaluateGate(gate(), [passed()], now + 600_001)).toBe("stale");
    expect(evaluateGate(gate(), [passed("console_api", "skipped")], now)).toBe("skipped");
    expect(evaluateGate(gate(), [passed("console_api", "failed")], now)).toBe("failed");
    expect(evaluateGate(gate(), [passed()], now)).toBe("passed");
    expect(evaluateGate(gate("evidence"), [passed()], now)).toBe("unknown");
  });

  it("requires owned SLO alerts and authenticated production reconciliation proof for GA", () => {
    const gates = surfaces.map(gate);
    const evidence = surfaces.map((surface) => passed(surface));
    const upstream = Object.fromEntries(
      gates.flatMap((item) => item.dependencies.map((dependency) => [dependency, true])),
    );
    expect(
      gates.every(
        (item) =>
          item.operationalOwner &&
          item.decisionOwner &&
          item.securityOwner &&
          item.alertRoutes.every((route) => route.owner && route.threshold),
      ),
    ).toBe(true);
    expect(
      gaReady(
        gates,
        evidence,
        upstream,
        false,
        { variance: 0, evidenceId: "reconciliation-1", productionProof: true },
        false,
        now,
      ),
    ).toBe(true);
    expect(
      gaReady(
        gates,
        evidence,
        upstream,
        false,
        { variance: 0, productionProof: false },
        false,
        now,
      ),
    ).toBe(false);
    expect(
      gaReady(
        gates,
        evidence,
        upstream,
        false,
        { variance: -1, evidenceId: "reconciliation-1", productionProof: true },
        false,
        now,
      ),
    ).toBe(false);
  });

  it("resolves trusted operator authority and preserves switch history across restart", async () => {
    const repository = new MemoryRepository();
    const resolver = { resolve: async () => authorizedActor };
    const firstProcess = new KillSwitches(repository, resolver, () => "switch-1");
    await firstProcess.change("opaque-session", "signed_ingress", false, "security incident", now);
    const restartedProcess = new KillSwitches(repository, resolver, () => "switch-2");
    expect(await restartedProcess.disposition("signed_ingress", false)).toBe("deny_new_work");
    expect(await restartedProcess.disposition("signed_ingress", true)).toBe("held");
    await restartedProcess.change(
      "opaque-session",
      "signed_ingress",
      true,
      "verified recovery",
      now + 1,
    );
    expect(await restartedProcess.permits("signed_ingress")).toBe(true);
    expect(await restartedProcess.history("signed_ingress")).toHaveLength(2);
    expect(repository.switches.map((item) => item.authorizationId)).toEqual([
      "authorization-1",
      "authorization-1",
    ]);
  });

  it("returns one generic denial for forged, stale-MFA, and missing security authority", async () => {
    const repository = new MemoryRepository();
    const attempts: Array<OperatorAuthorization | undefined> = [
      undefined,
      { ...authorizedActor, roles: [] },
      { ...authorizedActor, mfaVerifiedAt: now - 900_001 },
      { ...authorizedActor, securityApprovedSurfaces: [] },
    ];
    for (const actor of attempts) {
      const switches = new KillSwitches(repository, { resolve: async () => actor }, () => "id");
      await expect(
        switches.change("untrusted-input", "signed_ingress", false, "incident", now),
      ).rejects.toThrow("operator authorization denied");
    }
    expect(repository.switches).toHaveLength(0);
  });

  it("flags duplicate and blank provenance without calling a provided snapshot production proof", () => {
    expect(
      reconcile([
        {
          id: "a",
          workspaceId: "w",
          state: "terminal",
          provenance: "accepted",
          period: "2026-07",
        },
        {
          id: "a",
          workspaceId: "w",
          state: "duplicate",
          provenance: "duplicate",
          period: "2026-07",
        },
        {
          id: "b",
          workspaceId: "w",
          state: "dlq",
          provenance: "",
          period: "2026-07",
        },
      ]),
    ).toMatchObject({
      variance: 2,
      nonBillable: 2,
      source: "provided_snapshot",
      productionProof: false,
    });
  });

  it("publishes every surface without payload detail and requires alert ownership", () => {
    const status = publicStatus(
      { console_api: "failed" },
      { summary: "tenant payload stack", updatedAt: "now" },
    );
    expect(status.components.map((component) => component.surface)).toEqual(surfaces);
    expect(JSON.stringify(status)).not.toMatch(/tenant|payload|stack/);
    expect(alert("queue_dlq", "warning", "safe-1", "runbook", "delivery-operations")).toEqual({
      category: "queue_dlq",
      severity: "warning",
      correlationId: "safe-1",
      runbook: "runbook",
      owner: "delivery-operations",
    });
    expect(() => alert("queue_dlq", "warning", "safe-1", "runbook", "")).toThrow(
      "alert owner required",
    );
  });

  it("requires rollback evidence and labels unexecuted recovery plans honestly", () => {
    expect(
      rollbackAllowed({
        compatibleSchema: true,
        codeOrConfigOnly: true,
        knownGoodArtifact: false,
        evidenceRecorded: true,
        rootCauseRecorded: false,
        attempts: 2,
      }),
    ).toMatchObject({
      allowed: false,
      escalate: true,
      preservesEvidence: true,
      databaseRewind: false,
    });
    expect(restorePlan()).toMatchObject({
      isolationFirst: true,
      rpoMinutes: 15,
      productionProof: false,
    });
    expect(restorePlan().requiredEvidence).toContain("tenant_boundary_check_id");
  });

  it("honors measured canary windows and resets every critical breach to internal", () => {
    expect(
      nextStage(
        "internal",
        stageObservation({
          observedStage: "internal",
          healthyConsecutiveDays: 0,
          productionProof: false,
        }),
      ),
    ).toBe("internal");
    expect(nextStage("staff_canary", stageObservation({ healthyConsecutiveDays: 6 }))).toBe(
      "staff_canary",
    );
    expect(nextStage("staff_canary", stageObservation())).toBe("design_partners");
    expect(
      nextStage(
        "design_partners",
        stageObservation({
          observedStage: "design_partners",
          healthyConsecutiveDays: 14,
          partners: 3,
          organizations: 2,
          largeEstateAvailable: true,
        }),
      ),
    ).toBe("ga_review");
    expect(
      nextStage(
        "ga_review",
        stageObservation({ observedStage: "ga_review", criticalBreach: true }),
      ),
    ).toBe("internal");
  });
});
