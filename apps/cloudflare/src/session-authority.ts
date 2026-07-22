import { DurableObject } from "cloudflare:workers";

export type AuthoritySession = {
  id: string;
  requestToken: string;
  membershipVersion: number;
  createdAt: string;
  lastUsedAt: string;
  userAgentLabel: string;
  ipLabel: string;
};

export type AuthorityValidation =
  | { ok: true; session: AuthoritySession; epoch: number }
  | { ok: false; reason: "unknown" | "blocked" | "stale" | "quarantined" };

/** One deterministic object per canonical user. It never authorizes D1 membership itself. */
export class SessionAuthority extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS authority_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, request_token TEXT NOT NULL, membership_version INTEGER NOT NULL,
          created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, user_agent_label TEXT NOT NULL,
          ip_label TEXT NOT NULL
        );
      `);
      const version = this.ctx.storage.sql
        .exec<{ value: string }>("SELECT value FROM authority_meta WHERE key = 'schema_version'")
        .one();
      if (version && version.value !== "1") {
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO authority_meta (key, value) VALUES ('quarantined', '1')",
        );
        return;
      }
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO authority_meta (key, value) VALUES ('schema_version', '1'), ('epoch', '0'), ('blocked', '0'), ('quarantined', '0')",
      );
    });
  }

  private meta(key: string): string {
    return (
      this.ctx.storage.sql
        .exec<{ value: string }>("SELECT value FROM authority_meta WHERE key = ?", key)
        .one()?.value ?? ""
    );
  }

  private assertHealthy(): void {
    if (this.meta("quarantined") === "1") throw new Error("session authority quarantined");
  }

  async create(session: AuthoritySession): Promise<number> {
    this.assertHealthy();
    if (this.meta("blocked") === "1") throw new Error("session authority blocked");
    this.ctx.storage.sql.exec(
      "INSERT INTO sessions (id,request_token,membership_version,created_at,last_used_at,user_agent_label,ip_label) VALUES (?,?,?,?,?,?,?)",
      session.id,
      session.requestToken,
      session.membershipVersion,
      session.createdAt,
      session.lastUsedAt,
      session.userAgentLabel,
      session.ipLabel,
    );
    return Number(this.meta("epoch"));
  }

  async validate(
    sessionId: string,
    requestToken: string,
    membershipVersion: number,
  ): Promise<AuthorityValidation> {
    if (this.meta("quarantined") === "1") return { ok: false, reason: "quarantined" };
    if (this.meta("blocked") === "1") return { ok: false, reason: "blocked" };
    const session = this.ctx.storage.sql
      .exec<{
        id: string;
        request_token: string;
        membership_version: number;
        created_at: string;
        last_used_at: string;
        user_agent_label: string;
        ip_label: string;
      }>("SELECT * FROM sessions WHERE id = ?", sessionId)
      .one();
    if (!session || session.request_token !== requestToken) return { ok: false, reason: "unknown" };
    if (session.membership_version !== membershipVersion) return { ok: false, reason: "stale" };
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec("UPDATE sessions SET last_used_at = ? WHERE id = ?", now, sessionId);
    return {
      ok: true,
      epoch: Number(this.meta("epoch")),
      session: {
        id: session.id,
        requestToken: session.request_token,
        membershipVersion: session.membership_version,
        createdAt: session.created_at,
        lastUsedAt: now,
        userAgentLabel: session.user_agent_label,
        ipLabel: session.ip_label,
      },
    };
  }

  /** Revoke-first: block and rotate before D1 changes. A failed D1 write intentionally stays blocked. */
  async beginRevocation(): Promise<number> {
    this.assertHealthy();
    const epoch = Number(this.meta("epoch")) + 1;
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO authority_meta (key, value) VALUES ('blocked', '1'), ('epoch', ?)",
      String(epoch),
    );
    return epoch;
  }

  async allowOnlyMembershipVersion(version: number): Promise<void> {
    this.assertHealthy();
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE membership_version <> ?", version);
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO authority_meta (key, value) VALUES ('blocked', '0')",
    );
  }

  async revoke(sessionId?: string): Promise<void> {
    this.assertHealthy();
    if (sessionId) this.ctx.storage.sql.exec("DELETE FROM sessions WHERE id = ?", sessionId);
    else this.ctx.storage.sql.exec("DELETE FROM sessions");
  }

  /** Recovery must never resurrect credentials from restored storage. */
  async resetAfterRecovery(): Promise<number> {
    const epoch = Number(this.meta("epoch")) + 1;
    this.ctx.storage.sql.exec("DELETE FROM sessions");
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO authority_meta (key, value) VALUES ('epoch', ?), ('blocked', '0'), ('quarantined', '0'), ('schema_version', '1')",
      String(epoch),
    );
    return epoch;
  }
}
