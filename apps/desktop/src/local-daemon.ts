import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";

export class LocalMemoryDaemon {
  readonly database: DatabaseSync;
  readonly app = Fastify({ logger: false });
  #started = false;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    if (process.platform !== "win32") chmodSync(dataDir, 0o700);
    this.database = new DatabaseSync(join(dataDir, "eventforge.sqlite"));
    this.database.exec(
      `create table if not exists local_memory (id text primary key, workspace_id text, project_id text, content text, created_at text)`,
    );
    this.app.get("/health", async () => ({ ok: true, storage: "sqlite", vectorIndex: "disabled" }));
    this.app.get("/memory", async () =>
      this.database
        .prepare(
          "select id, workspace_id as workspaceId, project_id as projectId, content, created_at as createdAt from local_memory order by created_at desc limit 50",
        )
        .all(),
    );
  }

  async start(port = 4311): Promise<string | undefined> {
    if (this.#started) return;
    try {
      const address = await this.app.listen({ host: "127.0.0.1", port });
      this.#started = true;
      return address;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      if (code === "EADDRINUSE")
        throw new Error(
          `Local daemon port ${port} is already in use. Close the other EventForge instance or free the port.`,
        );
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#started) await this.app.close();
    if (this.database.isOpen) this.database.close();
    this.#started = false;
  }

  /** LanceDB is loaded only when vector search is enabled, keeping first launch dependable on all supported platforms. */
  async initializeVectorIndex(): Promise<{ available: boolean }> {
    try {
      await import("@lancedb/lancedb");
      return { available: true };
    } catch {
      return { available: false };
    }
  }
}
