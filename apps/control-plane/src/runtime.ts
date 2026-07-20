import type { AuthContext, RuntimeMode } from "@eventforge/core";
import type { FastifyRequest } from "fastify";

export type RequestAuthenticator = (request: FastifyRequest) => Promise<AuthContext | undefined>;

export type RuntimeConfig = {
  mode: RuntimeMode;
  bodyLimit: number;
  rateLimitPerMinute: number;
  agentRunsPerHour: number;
  bindHost: string;
};

export function createAutomationAuthContext(workspaceId: string): AuthContext {
  return {
    actorId: "eventforge-system",
    workspaceId,
    role: "operator",
    mfaVerified: true,
    scopes: ["eventforge:read", "eventforge:operate"],
  };
}

export function resolveRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  hasAuthenticator = false,
): RuntimeConfig {
  const mode: RuntimeMode =
    environment.EVENTFORGE_RUNTIME_MODE === "remote"
      ? "remote"
      : environment.NODE_ENV === "test"
        ? "test"
        : "local";
  if (mode === "remote") {
    const missing = [
      "DATABASE_URL",
      "EVENTFORGE_ENCRYPTION_KEY",
      "EVENTFORGE_ALLOWED_ORIGINS",
    ].filter((name) => !environment[name]);
    if (missing.length) throw new Error(`Remote mode requires ${missing.join(", ")}.`);
    if (!hasAuthenticator)
      throw new Error("Remote mode requires an authenticated request provider.");
  }
  const configuredHost = environment.EVENTFORGE_HOST ?? "127.0.0.1";
  if (
    mode === "local" &&
    configuredHost !== "127.0.0.1" &&
    configuredHost !== "localhost" &&
    configuredHost !== "::1"
  ) {
    throw new Error("Local mode must bind to a loopback address.");
  }
  return {
    mode,
    bodyLimit: Number(environment.EVENTFORGE_BODY_LIMIT ?? 1_048_576),
    rateLimitPerMinute: Number(
      environment.EVENTFORGE_RATE_LIMIT_PER_MINUTE ?? (mode === "local" ? 600 : 120),
    ),
    agentRunsPerHour: Number(environment.EVENTFORGE_AGENT_RUNS_PER_HOUR ?? 20),
    bindHost: configuredHost,
  };
}

export class FixedWindowLimiter {
  #buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.#buckets.get(key);
    const bucket =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + this.windowMs } : current;
    bucket.count += 1;
    this.#buckets.set(key, bucket);
    return {
      allowed: bucket.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
}
