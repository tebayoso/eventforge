import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalMemoryDaemon } from "../src/local-daemon.js";

describe("local memory daemon", () => {
  it("creates a private SQLite store", async () => {
    const daemon = new LocalMemoryDaemon(mkdtempSync(join(tmpdir(), "eventforge-")));
    const rows = daemon.database.prepare("select name from sqlite_master where type='table' and name='local_memory'").all();
    expect(rows).toHaveLength(1);
    await daemon.stop();
  });
});
