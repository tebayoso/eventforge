import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  checksumOf,
  planMigrations,
  readMigrations,
  type AppliedMigration,
} from "../src/migrate.js";

const tempDir = async () => mkdtemp(join(tmpdir(), "eventforge-migrations-"));

describe("migration discovery", () => {
  it("orders the shipped migrations deterministically and numbers them uniquely", async () => {
    // Regression: seven files once shared the number 004, so no total order
    // existed and the schema a deploy produced depended on readdir ordering.
    const files = await readMigrations(MIGRATIONS_DIR);
    expect(files.length).toBeGreaterThan(0);
    const names = files.map((file) => file.name);
    expect(names).toEqual([...names].sort());
    const numbers = names.map((name) => name.slice(0, name.indexOf("_")));
    expect(new Set(numbers).size, `duplicate migration numbers in ${numbers.join(", ")}`).toBe(
      numbers.length,
    );
  });

  it("refuses a directory where two migrations share a number", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "001_first.sql"), "select 1;");
    await writeFile(join(dir, "001_second.sql"), "select 2;");
    await expect(readMigrations(dir)).rejects.toThrow("must be unique");
  });

  it("refuses filenames that carry no order", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "add-widgets.sql"), "select 1;");
    await expect(readMigrations(dir)).rejects.toThrow("<number>_<snake_case>.sql");
  });
});

describe("migration planning", () => {
  const files = [
    { name: "001_a.sql", sql: "select 1;", checksum: checksumOf("select 1;") },
    { name: "002_b.sql", sql: "select 2;", checksum: checksumOf("select 2;") },
  ];

  it("treats an empty ledger as everything pending", () => {
    expect(planMigrations(files, []).pending.map((f) => f.name)).toEqual([
      "001_a.sql",
      "002_b.sql",
    ]);
  });

  it("is a no-op once every migration is recorded", () => {
    const applied: AppliedMigration[] = files.map(({ name, checksum }) => ({ name, checksum }));
    const plan = planMigrations(files, applied);
    expect(plan.pending).toEqual([]);
    expect(plan.drifted).toEqual([]);
  });

  it("reports drift instead of silently skipping an edited migration", () => {
    // Editing an applied migration cannot be detected by name alone. Without the
    // checksum the runner would report "already current" while the database and
    // the file disagree — the schema would differ per environment.
    const plan = planMigrations(files, [
      { name: "001_a.sql", checksum: checksumOf("select 1;") },
      { name: "002_b.sql", checksum: checksumOf("something else entirely") },
    ]);
    expect(plan.pending).toEqual([]);
    expect(plan.drifted.map((d) => d.name)).toEqual(["002_b.sql"]);
  });

  it("reports ledger rows this checkout does not ship", () => {
    const plan = planMigrations(files, [
      ...files.map(({ name, checksum }) => ({ name, checksum })),
      { name: "003_from_the_future.sql", checksum: "deadbeef" },
    ]);
    expect(plan.missing.map((row) => row.name)).toEqual(["003_from_the_future.sql"]);
  });

  it("applies pending migrations in filename order, not ledger order", () => {
    const plan = planMigrations(files, [{ name: "002_b.sql", checksum: checksumOf("select 2;") }]);
    expect(plan.pending.map((f) => f.name)).toEqual(["001_a.sql"]);
  });
});
