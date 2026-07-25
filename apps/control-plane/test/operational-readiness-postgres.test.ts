import { describe, expect, it, vi } from "vitest";
import { PostgresOperationalReadinessRepository } from "../src/operational-readiness-postgres.js";
import type { Evidence, SwitchChange } from "../src/operational-readiness.js";

describe("PostgresOperationalReadinessRepository", () => {
  it("writes append-only evidence with tenant and provenance fields", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresOperationalReadinessRepository({ query } as never);
    const evidence: Evidence = {
      id: "00000000-0000-4000-8000-000000000001",
      workspaceId: "workspace-1",
      surface: "evidence",
      result: "passed",
      observedAt: 1_000,
      kind: "probe",
      correlationId: "correlation-1",
      provenance: { monitor: "authorized-export" },
    };

    await repository.appendEvidence(evidence);

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]![0]).toContain("insert into eventforge_launch_evidence");
    expect(query.mock.calls[0]![1]).toEqual([
      evidence.id,
      evidence.workspaceId,
      evidence.surface,
      evidence.result,
      evidence.kind,
      evidence.correlationId,
      new Date(evidence.observedAt),
      evidence.provenance,
    ]);
  });

  it("reloads persisted evidence and latest switch state rather than process memory", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            workspace_id: "workspace-1",
            surface: "console_api",
            result: "passed",
            observed_at: new Date(1_000),
            evidence_kind: "probe",
            correlation_id: "correlation-1",
            provenance: { monitor: "journey" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            surface: "signed_ingress",
            enabled: false,
            actor_id: "operator-1",
            authorization_id: "authorization-1",
            mfa_verified_at: new Date(900),
            security_authorized: true,
            reason: "incident",
            created_at: new Date(1_000),
          },
        ],
      });
    const repository = new PostgresOperationalReadinessRepository({ query } as never);

    await expect(repository.listEvidence("workspace-1")).resolves.toMatchObject([
      { workspaceId: "workspace-1", observedAt: 1_000 },
    ]);
    await expect(repository.latestSwitch("signed_ingress")).resolves.toMatchObject({
      authorizationId: "authorization-1",
      enabled: false,
      changedAt: 1_000,
    });
  });

  it("persists every switch transition with verifiable authorization context", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresOperationalReadinessRepository({ query } as never);
    const change: SwitchChange = {
      id: "00000000-0000-4000-8000-000000000002",
      surface: "remote_mcp",
      enabled: false,
      changedBy: "operator-1",
      changedAt: 1_000,
      reason: "security incident",
      authorizationId: "authorization-1",
      mfaVerifiedAt: 900,
      securityAuthorized: true,
    };

    await repository.appendSwitchChange(change);

    expect(query.mock.calls[0]![0]).toContain("insert into eventforge_kill_switch_audit");
    expect(query.mock.calls[0]![1]).toContain("authorization-1");
  });
});
