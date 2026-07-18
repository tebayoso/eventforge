import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalMemoryDaemon } from "../src/local-daemon.js";

describe("local memory daemon", () => {
  it("creates a private SQLite store", async () => {
    const daemon = new LocalMemoryDaemon(mkdtempSync(join(tmpdir(), "eventforge-")));
    const rows = daemon.database
      .prepare("select name from sqlite_master where type='table' and name='local_memory'")
      .all();
    expect(rows).toHaveLength(1);
    await daemon.stop();
  });

  it("reports only the storage capabilities that are enabled", async () => {
    const daemon = new LocalMemoryDaemon(mkdtempSync(join(tmpdir(), "eventforge-")));
    const response = await daemon.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, storage: "sqlite", vectorIndex: "disabled" });
    await daemon.stop();
  });

  it("serves scoped memory on a loopback port and shuts down cleanly", async () => {
    const daemon = new LocalMemoryDaemon(mkdtempSync(join(tmpdir(), "eventforge-")));
    daemon.database
      .prepare("insert into local_memory values (?, ?, ?, ?, ?)")
      .run("memory-1", "workspace-1", "project-1", "CI finding", "2026-07-18T00:00:00.000Z");
    const address = await daemon.start(0);
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${address}/memory`);
    expect(await response.json()).toEqual([
      {
        id: "memory-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        content: "CI finding",
        createdAt: "2026-07-18T00:00:00.000Z",
      },
    ]);
    await expect(daemon.start(0)).resolves.toBeUndefined();
    await daemon.stop();
  });

  it("fails loudly when another daemon owns the configured port", async () => {
    const first = new LocalMemoryDaemon(mkdtempSync(join(tmpdir(), "eventforge-first-")));
    const address = await first.start(0);
    const port = Number(new URL(address!).port);
    const second = new LocalMemoryDaemon(mkdtempSync(join(tmpdir(), "eventforge-second-")));
    await expect(second.start(port)).rejects.toThrow(`Local daemon port ${port} is already in use`);
    await second.stop();
    await first.stop();
  });

  it("checks whether the optional vector dependency is available", async () => {
    const daemon = new LocalMemoryDaemon(mkdtempSync(join(tmpdir(), "eventforge-")));
    await expect(daemon.initializeVectorIndex()).resolves.toEqual({ available: true });
    await daemon.stop();
  });
});
