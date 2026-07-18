import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { AuditEntry, EventEnvelope } from "@eventforge/core";

export type DurableJob = {
  id: string;
  workspaceId: string;
  eventId: string;
  kind: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
};

/** PostgreSQL source-of-truth primitives. Callers keep transactions short and do agent work outside a lease transaction. */
export class PostgresStore {
  #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
  }

  async ingestEvent(input: {
    event: EventEnvelope;
    installationKey: string;
    deliveryId: string;
    jobKind: string;
  }): Promise<{ created: boolean; eventId: string; jobId?: string }> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `insert into eventforge_events
          (id, workspace_id, project_id, repository, provider, topic, installation_key, delivery_id, payload, occurred_at, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (provider, installation_key, delivery_id) do nothing
         returning id`,
        [
          input.event.id,
          input.event.workspaceId,
          input.event.projectId,
          input.event.repository,
          input.event.provider,
          input.event.topic,
          input.installationKey,
          input.deliveryId,
          input.event.payload,
          input.event.occurredAt,
          input.event.receivedAt,
        ],
      );
      if (!inserted.rowCount) {
        const existing = await client.query<{ id: string }>(
          "select id from eventforge_events where provider = $1 and installation_key = $2 and delivery_id = $3",
          [input.event.provider, input.installationKey, input.deliveryId],
        );
        await client.query("commit");
        return { created: false, eventId: existing.rows[0]!.id };
      }
      const jobId = randomUUID();
      await client.query(
        `insert into eventforge_jobs
          (id, workspace_id, event_id, kind, status, idempotency_key, payload)
         values ($1, $2, $3, $4, 'pending', $5, $6)`,
        [
          jobId,
          input.event.workspaceId,
          input.event.id,
          input.jobKind,
          `${input.event.provider}:${input.installationKey}:${input.deliveryId}:${input.jobKind}`,
          input.event.payload,
        ],
      );
      await this.insertAudit(client, {
        id: randomUUID(),
        workspaceId: input.event.workspaceId,
        kind: "event_received",
        subjectId: input.event.id,
        message: `${input.event.provider}:${input.event.topic} accepted (verified).`,
        createdAt: input.event.receivedAt,
      });
      await client.query("commit");
      return { created: true, eventId: input.event.id, jobId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimJob(workerId: string, leaseSeconds = 60): Promise<DurableJob | undefined> {
    const result = await this.#pool.query<{
      id: string;
      workspace_id: string;
      event_id: string;
      kind: string;
      status: string;
      attempts: number;
      payload: Record<string, unknown>;
    }>(
      `update eventforge_jobs
       set status = 'processing', worker_id = $1, attempts = attempts + 1,
           lease_expires_at = now() + make_interval(secs => $2), updated_at = now()
       where id = (
         select id from eventforge_jobs
         where (status = 'pending' and available_at <= now())
            or (status = 'processing' and lease_expires_at <= now())
         order by available_at, created_at
         limit 1 for update skip locked
       )
       returning id, workspace_id, event_id, kind, status, attempts, payload`,
      [workerId, leaseSeconds],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          workspaceId: row.workspace_id,
          eventId: row.event_id,
          kind: row.kind,
          status: row.status,
          attempts: row.attempts,
          payload: row.payload,
        }
      : undefined;
  }

  async completeJob(id: string, workerId: string): Promise<boolean> {
    const result = await this.#pool.query(
      `update eventforge_jobs set status = 'completed', lease_expires_at = null, updated_at = now()
       where id = $1 and worker_id = $2 and status = 'processing'`,
      [id, workerId],
    );
    return result.rowCount === 1;
  }

  async failJob(id: string, workerId: string, error: string): Promise<boolean> {
    const result = await this.#pool.query(
      `update eventforge_jobs
       set status = case when attempts >= max_attempts then 'dead_letter' else 'pending' end,
           available_at = now() + make_interval(secs => least(300, power(2, attempts)::integer)),
           lease_expires_at = null, last_error = left($3, 2000), updated_at = now()
       where id = $1 and worker_id = $2 and status = 'processing'`,
      [id, workerId, error],
    );
    return result.rowCount === 1;
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.insertAudit(this.#pool, entry);
  }

  private async insertAudit(
    client: Pick<PoolClient, "query"> | Pool,
    entry: AuditEntry,
  ): Promise<void> {
    await client.query(
      `insert into eventforge_audit_entries (id, workspace_id, kind, subject_id, message, created_at)
       values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
      [entry.id, entry.workspaceId, entry.kind, entry.subjectId, entry.message, entry.createdAt],
    );
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
