# Control-plane schema migrations

Forward-only runner for the control-plane Postgres schema
(`apps/control-plane/migrations/*.sql`).

Before this existed, the repository shipped SQL files with **no runner at all** — every
migration had to be applied by hand. That was a release-blocking operational gap, and it
is why seven files all carried the number `004` with no total ordering between them.

## Usage

```bash
export EVENTFORGE_DATABASE_URL=postgres://user:pass@host:5432/eventforge   # or DATABASE_URL

pnpm --filter @eventforge/control-plane migrate:list     # order + checksums, no database needed
pnpm --filter @eventforge/control-plane migrate:status   # what would apply; never writes
pnpm --filter @eventforge/control-plane migrate          # apply pending migrations
```

Exit code is `0` on success and `1` on failure, so this is safe to gate a deploy on.

## Prerequisite: pgvector

`001_init.sql` runs `create extension if not exists vector`, so the target database must
have **pgvector** available. Discovered by running the runner against stock
`postgres:16-alpine`, which fails with `extension "vector" is not available`. Use
`pgvector/pgvector:pg16` locally, or enable the extension on the managed instance.

## Guarantees

- Files apply in **lexicographic filename order**, each in its own transaction. A failure
  rolls back the failing migration and leaves earlier ones committed.
- A ledger table `eventforge_schema_migrations (name, checksum, applied_at)` records each
  applied file, so re-running is a no-op.
- **Checksum drift is an error, not a silent skip.** Editing an already-applied migration
  aborts the run. Name-only tracking would report "already current" while the database and
  the file disagreed, letting environments drift apart silently. Add a new migration
  instead of editing an applied one.
- A **session advisory lock** serialises concurrent deployers, so two instances starting at
  once cannot both apply the same migration.
- Ledger rows with no matching file are reported as a warning — usually a rollback to an
  older revision against a newer database.

## Filename rules (enforced)

`<number>_<snake_case>.sql`, and **numbers must be unique**. Two files sharing a number have
no defined order relative to each other, so the schema a deployment produces would depend on
filesystem ordering. `readMigrations()` rejects both violations, and
`apps/control-plane/test/migrate.test.ts` asserts the shipped directory satisfies them.

## Verified

Against real Postgres (`pgvector/pgvector:pg16`): all 10 migrations apply cleanly creating
29 tables; a second run reports "Schema already current"; a tampered applied migration exits
`1` with a drift error; a missing connection string exits `1`.

## Cloudflare D1

The Worker's D1 databases are separate and already managed by wrangler
(`migrations_dir` in `apps/cloudflare/wrangler.jsonc`) via `wrangler d1 migrations apply`.
This runner does not touch them.

Note `apps/cloudflare/migrations/control/` still has two files numbered `0003`
(`0003_delivery_installations.sql`, `0003_hosted_identity.sql`). They sort deterministically
by full filename so wrangler's order is stable, and renaming them would break wrangler's
ledger for databases where they are already applied — so they are deliberately left alone.
