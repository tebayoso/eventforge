import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeEvent } from "@eventforge/core";

const pg = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: class {
    query = pg.query;
    connect = pg.connect;
    end = pg.end;
  },
}));

describe("PostgreSQL persistence primitives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pg.connect.mockResolvedValue({ query: pg.clientQuery, release: pg.release });
    pg.end.mockResolvedValue(undefined);
    pg.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("insert into eventforge_events"))
        return { rowCount: 1, rows: [{ id: "event-id" }] };
      return { rowCount: 1, rows: [] };
    });
  });

  it("commits event, dedupe key, audit, and job in one transaction", async () => {
    const { PostgresStore } = await import("../src/postgres-store.js");
    const store = new PostgresStore("postgres://test");
    const event = normalizeEvent({
      provider: "github",
      workspaceId: "w",
      projectId: "p",
      payload: {},
      signatureStatus: "verified",
      deliveryId: "delivery",
    });
    await expect(
      store.ingestEvent({
        event,
        installationKey: "install",
        deliveryId: "delivery",
        jobKind: "workflow",
      }),
    ).resolves.toMatchObject({ created: true, eventId: event.id, jobId: expect.any(String) });
    expect(pg.clientQuery.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining(["begin", "commit"]),
    );
    expect(pg.release).toHaveBeenCalled();
  });

  it("returns the existing event for duplicate deliveries", async () => {
    pg.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("insert into eventforge_events")) return { rowCount: 0, rows: [] };
      if (sql.includes("select id from eventforge_events"))
        return { rowCount: 1, rows: [{ id: "existing-id" }] };
      return { rowCount: 1, rows: [] };
    });
    const { PostgresStore } = await import("../src/postgres-store.js");
    const store = new PostgresStore("postgres://test");
    const event = normalizeEvent({
      provider: "github",
      workspaceId: "w",
      projectId: "p",
      payload: {},
      signatureStatus: "verified",
    });
    await expect(
      store.ingestEvent({
        event,
        installationKey: "install",
        deliveryId: "duplicate",
        jobKind: "workflow",
      }),
    ).resolves.toEqual({ created: false, eventId: "existing-id" });
  });

  it("rolls back and releases the client after persistence failure", async () => {
    pg.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("insert into eventforge_events")) throw new Error("database unavailable");
      return { rowCount: 1, rows: [] };
    });
    const { PostgresStore } = await import("../src/postgres-store.js");
    const store = new PostgresStore("postgres://test");
    const event = normalizeEvent({
      provider: "github",
      workspaceId: "w",
      projectId: "p",
      payload: {},
      signatureStatus: "verified",
    });
    await expect(
      store.ingestEvent({
        event,
        installationKey: "install",
        deliveryId: "failure",
        jobKind: "workflow",
      }),
    ).rejects.toThrow("database unavailable");
    expect(pg.clientQuery).toHaveBeenCalledWith("rollback");
    expect(pg.release).toHaveBeenCalled();
  });

  it("claims, completes, retries, audits, and closes jobs", async () => {
    pg.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "job-1",
            workspace_id: "w",
            event_id: "event-1",
            kind: "workflow",
            status: "processing",
            attempts: 1,
            payload: { safe: true },
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { PostgresStore } = await import("../src/postgres-store.js");
    const store = new PostgresStore("postgres://test");
    await expect(store.claimJob("worker", 30)).resolves.toMatchObject({ id: "job-1", attempts: 1 });
    await expect(store.completeJob("job-1", "worker")).resolves.toBe(true);
    await expect(store.failJob("job-2", "worker", "failed")).resolves.toBe(false);
    await store.appendAudit({
      id: randomUUID(),
      workspaceId: "w",
      kind: "agent_run",
      subjectId: "run",
      message: "done",
      createdAt: new Date().toISOString(),
    });
    await store.close();
    expect(pg.end).toHaveBeenCalled();
  });

  it("persists audit sink entries and closes its pool", async () => {
    pg.query.mockResolvedValue({ rowCount: 1, rows: [] });
    const { PostgresAuditSink } = await import("../src/postgres-audit.js");
    const sink = new PostgresAuditSink("postgres://test");
    await sink.append({
      id: randomUUID(),
      workspaceId: "w",
      kind: "approval",
      subjectId: "a",
      message: "approved",
      createdAt: new Date().toISOString(),
    });
    await sink.close();
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("eventforge_audit_entries"),
      expect.any(Array),
    );
  });
});
