import type { Pool } from "pg";
import type {
  Evidence,
  OperationalReadinessRepository,
  Surface,
  SwitchChange,
} from "./operational-readiness.js";

type Queryable = Pick<Pool, "query">;

type EvidenceRow = {
  id: string;
  workspace_id: string;
  surface: Surface;
  result: Evidence["result"];
  observed_at: Date;
  evidence_kind: Evidence["kind"];
  correlation_id: string;
  provenance: Record<string, unknown>;
};

type SwitchRow = {
  id: string;
  surface: Surface;
  enabled: boolean;
  actor_id: string;
  authorization_id: string;
  mfa_verified_at: Date;
  security_authorized: boolean;
  reason: string;
  created_at: Date;
};

/** Durable append-only adapter. Database errors propagate so callers fail closed. */
export class PostgresOperationalReadinessRepository implements OperationalReadinessRepository {
  constructor(private readonly database: Queryable) {}

  async appendEvidence(record: Evidence): Promise<void> {
    await this.database.query(
      `insert into eventforge_launch_evidence
        (id, workspace_id, surface, result, evidence_kind, correlation_id, observed_at, provenance)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.id,
        record.workspaceId,
        record.surface,
        record.result,
        record.kind,
        record.correlationId,
        new Date(record.observedAt),
        record.provenance,
      ],
    );
  }

  async listEvidence(workspaceId: string): Promise<readonly Evidence[]> {
    const result = await this.database.query<EvidenceRow>(
      `select id, workspace_id, surface, result, observed_at, evidence_kind, correlation_id, provenance
       from eventforge_launch_evidence
       where workspace_id = $1
       order by observed_at, created_at, id`,
      [workspaceId],
    );
    return result.rows.map((row) =>
      Object.freeze({
        id: row.id,
        workspaceId: row.workspace_id,
        surface: row.surface,
        result: row.result,
        observedAt: row.observed_at.getTime(),
        kind: row.evidence_kind,
        correlationId: row.correlation_id,
        provenance: Object.freeze({ ...row.provenance }),
      }),
    );
  }

  async appendSwitchChange(change: SwitchChange): Promise<void> {
    await this.database.query(
      `insert into eventforge_kill_switch_audit
        (id, surface, enabled, actor_id, authorization_id, mfa_verified_at,
         security_authorized, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        change.id,
        change.surface,
        change.enabled,
        change.changedBy,
        change.authorizationId,
        new Date(change.mfaVerifiedAt),
        change.securityAuthorized,
        change.reason,
        new Date(change.changedAt),
      ],
    );
  }

  async latestSwitch(surface: Surface): Promise<SwitchChange | undefined> {
    const result = await this.database.query<SwitchRow>(
      `select id, surface, enabled, actor_id, authorization_id, mfa_verified_at,
              security_authorized, reason, created_at
       from eventforge_kill_switch_audit
       where surface = $1
       order by created_at desc, id desc
       limit 1`,
      [surface],
    );
    return result.rows[0] ? this.toSwitch(result.rows[0]) : undefined;
  }

  async listSwitchChanges(surface: Surface): Promise<readonly SwitchChange[]> {
    const result = await this.database.query<SwitchRow>(
      `select id, surface, enabled, actor_id, authorization_id, mfa_verified_at,
              security_authorized, reason, created_at
       from eventforge_kill_switch_audit
       where surface = $1
       order by created_at, id`,
      [surface],
    );
    return result.rows.map((row) => this.toSwitch(row));
  }

  private toSwitch(row: SwitchRow): SwitchChange {
    return Object.freeze({
      id: row.id,
      surface: row.surface,
      enabled: row.enabled,
      changedBy: row.actor_id,
      authorizationId: row.authorization_id,
      mfaVerifiedAt: row.mfa_verified_at.getTime(),
      securityAuthorized: row.security_authorized,
      reason: row.reason,
      changedAt: row.created_at.getTime(),
    });
  }
}
