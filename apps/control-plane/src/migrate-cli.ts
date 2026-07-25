import { migrate, planMigrations, readMigrations } from "./migrate.js";

// CLI wrapper: `pnpm --filter @eventforge/control-plane migrate [--dry-run|--list]`
//
// Exit codes: 0 success, 1 failure. `--dry-run` and `--list` never write.

function databaseUrl(): string {
  const url = process.env.EVENTFORGE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Set EVENTFORGE_DATABASE_URL (or DATABASE_URL) to the control-plane Postgres connection string.",
    );
  }
  return url;
}

async function main() {
  const args = new Set(process.argv.slice(2));

  // --list needs no database, so it works in CI and on a developer machine.
  if (args.has("--list")) {
    const files = await readMigrations();
    const plan = planMigrations(files, []);
    console.log(`${files.length} migration(s), in apply order:`);
    for (const file of plan.pending) console.log(`  ${file.name}  ${file.checksum.slice(0, 12)}`);
    return;
  }

  const dryRun = args.has("--dry-run") || args.has("--status");
  const { applied, plan } = await migrate(databaseUrl(), { dryRun });

  if (plan.missing.length > 0) {
    // The ledger knows a migration this checkout does not ship. Usually a
    // rollback to an older revision against a newer database.
    console.warn(
      `warning: ${plan.missing.length} applied migration(s) are absent from this checkout: ${plan.missing
        .map((row) => row.name)
        .join(", ")}`,
    );
  }

  if (dryRun) {
    console.log(
      `${plan.applied.length} applied, ${plan.pending.length} pending${
        plan.pending.length > 0 ? ":" : "."
      }`,
    );
    for (const file of plan.pending) console.log(`  pending  ${file.name}`);
    return;
  }

  if (applied.length === 0) {
    console.log(`Schema already current (${plan.applied.length} migration(s) applied).`);
    return;
  }
  console.log(`Applied ${applied.length} migration(s):`);
  for (const name of applied) console.log(`  ${name}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
