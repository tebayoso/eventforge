import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

// Forward-only migration runner for the control-plane Postgres schema.
//
// Until now the repository shipped SQL files with no runner at all, so every
// migration had to be applied by hand — a release-blocking operational gap and
// the reason seven files all carried the number 004 with no total ordering.
//
// Guarantees:
//   - files apply in lexicographic filename order, one transaction each
//   - a ledger row records name + sha256, so re-runs are no-ops
//   - a checksum change on an applied file is an error, not a silent skip
//   - a session advisory lock serialises concurrent deployers
//   - `plan`/`status` never write, so they are safe against production

const LEDGER_LOCK_KEY = 4_121_990_517;

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export type MigrationFile = { name: string; sql: string; checksum: string };
export type AppliedMigration = { name: string; checksum: string };

export type MigrationPlan = {
  pending: MigrationFile[];
  applied: AppliedMigration[];
  drifted: Array<{ name: string; expected: string; actual: string }>;
  missing: AppliedMigration[];
};

export const checksumOf = (sql: string) => createHash("sha256").update(sql).digest("hex");

const MIGRATION_NAME = /^\d{3,}_[a-z0-9_]+\.sql$/;

/** Reads migration files in lexicographic order and rejects ambiguous numbering. */
export async function readMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  const malformed = names.filter((n) => !MIGRATION_NAME.test(n));
  if (malformed.length > 0) {
    throw new Error(
      `Migration filenames must be <number>_<snake_case>.sql: ${malformed.join(", ")}`,
    );
  }
  const byNumber = new Map<string, string[]>();
  for (const name of names) {
    const prefix = name.slice(0, name.indexOf("_"));
    byNumber.set(prefix, [...(byNumber.get(prefix) ?? []), name]);
  }
  const duplicates = [...byNumber.entries()].filter(([, group]) => group.length > 1);
  if (duplicates.length > 0) {
    // Two files sharing a number have no defined order relative to each other,
    // so the schema a deployment produces would depend on filesystem ordering.
    throw new Error(
      `Migration numbers must be unique; duplicates: ${duplicates
        .map(([prefix, group]) => `${prefix} (${group.join(", ")})`)
        .join("; ")}`,
    );
  }
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(dir, name), "utf8");
      return { name, sql, checksum: checksumOf(sql) };
    }),
  );
}

async function ensureLedger(client: Pick<PoolClient, "query">) {
  await client.query(`
    create table if not exists eventforge_schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function readLedger(client: Pick<PoolClient, "query">): Promise<AppliedMigration[]> {
  const { rows } = await client.query<{ name: string; checksum: string }>(
    "select name, checksum from eventforge_schema_migrations order by name",
  );
  return rows;
}

/** Compares files against the ledger without writing anything. */
export function planMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationPlan {
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));
  const fileNames = new Set(files.map((file) => file.name));
  return {
    applied,
    pending: files.filter((file) => !appliedByName.has(file.name)),
    drifted: files
      .filter(
        (file) => appliedByName.has(file.name) && appliedByName.get(file.name) !== file.checksum,
      )
      .map((file) => ({
        name: file.name,
        expected: appliedByName.get(file.name)!,
        actual: file.checksum,
      })),
    missing: applied.filter((row) => !fileNames.has(row.name)),
  };
}

export type MigrateResult = { applied: string[]; plan: MigrationPlan };

/**
 * Applies every pending migration. Each file runs in its own transaction, so a
 * failure leaves earlier migrations committed and the failing one rolled back.
 */
export async function migrate(
  databaseUrl: string,
  options: { dryRun?: boolean; dir?: string } = {},
): Promise<MigrateResult> {
  const files = await readMigrations(options.dir);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock($1)", [LEDGER_LOCK_KEY]);
      try {
        await ensureLedger(client);
        const plan = planMigrations(files, await readLedger(client));

        if (plan.drifted.length > 0) {
          throw new Error(
            `Applied migrations changed on disk, refusing to continue: ${plan.drifted
              .map((d) => d.name)
              .join(", ")}. Add a new migration instead of editing an applied one.`,
          );
        }
        if (options.dryRun) return { applied: [], plan };

        const applied: string[] = [];
        for (const file of plan.pending) {
          await client.query("begin");
          try {
            await client.query(file.sql);
            await client.query(
              "insert into eventforge_schema_migrations (name, checksum) values ($1, $2)",
              [file.name, file.checksum],
            );
            await client.query("commit");
            applied.push(file.name);
          } catch (error) {
            await client.query("rollback");
            throw new Error(
              `Migration ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return { applied, plan };
      } finally {
        await client.query("select pg_advisory_unlock($1)", [LEDGER_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
