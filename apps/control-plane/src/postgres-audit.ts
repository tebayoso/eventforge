import { Pool } from "pg";
import type { AuditEntry } from "@eventforge/core";

/** Durable audit sink. The in-memory projection remains fast for a local demo while every accepted audit entry is also persisted. */
export class PostgresAuditSink {
  #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.#pool.query(
      `insert into eventforge_audit_entries (id, workspace_id, kind, subject_id, message, created_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing`,
      [entry.id, entry.workspaceId, entry.kind, entry.subjectId, entry.message, entry.createdAt],
    );
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
