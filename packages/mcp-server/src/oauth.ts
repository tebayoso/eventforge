import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_SCOPES = ["eventforge:read", "eventforge:review"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export type FirstPartyClient = {
  id: string;
  name: string;
  redirectUris: readonly string[];
  audiences: readonly string[];
  allowedScopes: readonly OAuthScope[];
};

export type IdentityAuthority = {
  assertCurrent(input: {
    actorId: string;
    workspaceId: string;
    clientId: string;
    sessionId?: string;
  }): Promise<{ active: boolean; mfaVerified: boolean }>;
};

export type OAuthGrantRepository = {
  putCode(code: AuthorizationCode): Promise<void>;
  takeCode(value: string): Promise<AuthorizationCode | undefined>;
  putToken(token: TokenRecord): Promise<void>;
  token(value: string): Promise<TokenRecord | undefined>;
  revokeFamily(familyId: string): Promise<void>;
};

type AuthorizationCode = {
  value: string;
  clientId: string;
  redirectUri: string;
  actorId: string;
  sessionId?: string;
  workspaceId: string;
  audience: string;
  scopes: OAuthScope[];
  challenge: string;
  expiresAt: number;
};

type TokenRecord = {
  value: string;
  kind: "access" | "refresh";
  clientId: string;
  actorId: string;
  sessionId?: string;
  workspaceId: string;
  audience: string;
  scopes: OAuthScope[];
  familyId: string;
  expiresAt: number;
  revoked: boolean;
  used: boolean;
};

export class InMemoryOAuthGrantRepository implements OAuthGrantRepository {
  #codes = new Map<string, AuthorizationCode>();
  #tokens = new Map<string, TokenRecord>();
  async putCode(code: AuthorizationCode) {
    this.#codes.set(code.value, code);
  }
  async takeCode(value: string) {
    const code = this.#codes.get(value);
    if (code) this.#codes.delete(value);
    return code;
  }
  async putToken(token: TokenRecord) {
    this.#tokens.set(token.value, token);
  }
  async token(value: string) {
    return this.#tokens.get(value);
  }
  async revokeFamily(familyId: string) {
    for (const token of this.#tokens.values())
      if (token.familyId === familyId) token.revoked = true;
  }
}

export class OAuthSecurityEventSink {
  readonly events: Array<{ workspaceId: string; type: "refresh_reuse" }> = [];
  refreshReuse(workspaceId: string) {
    this.events.push({ workspaceId, type: "refresh_reuse" });
  }
}

const ACCESS_TTL_MS = 15 * 60_000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const SKEW_MS = 30_000;
const opaque = () => randomBytes(32).toString("base64url");
const equals = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function isAllowedRedirect(client: FirstPartyClient, value: string): boolean {
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    return false;
  }
  if (redirect.username || redirect.password || redirect.hash) return false;
  if (redirect.protocol === "https:") return client.redirectUris.includes(value);
  const loopback = redirect.hostname === "127.0.0.1" || redirect.hostname === "[::1]";
  if (!loopback || redirect.protocol !== "http:") return false;
  return client.redirectUris.some((registered) => {
    const expected = new URL(registered);
    return (
      expected.protocol === "http:" &&
      expected.hostname === redirect.hostname &&
      expected.pathname === redirect.pathname &&
      !expected.search &&
      !redirect.search
    );
  });
}

export class OAuthAuthorizationService {
  #refreshLocks = new Map<string, Promise<TokenResponse>>();
  constructor(
    private readonly clients: readonly FirstPartyClient[],
    private readonly grants: OAuthGrantRepository,
    private readonly authority: IdentityAuthority,
    private readonly securityEvents = new OAuthSecurityEventSink(),
    private readonly now = () => Date.now(),
  ) {}

  metadata(resource: string) {
    if (!resource.startsWith("https://")) throw new Error("OAuth resource must use HTTPS.");
    return {
      resource,
      authorization_servers: [`${resource}/oauth`],
      scopes_supported: OAUTH_SCOPES,
      bearer_methods_supported: ["header"],
    };
  }

  async authorize(input: {
    clientId: string;
    redirectUri: string;
    actorId: string;
    sessionId?: string;
    workspaceId: string;
    audience: string;
    scopes: OAuthScope[];
    codeChallenge: string;
    codeChallengeMethod: "S256";
  }): Promise<{ code: string; expiresIn: number }> {
    const client = this.clients.find((candidate) => candidate.id === input.clientId);
    if (
      !client ||
      input.codeChallengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)
    )
      throw new Error("Invalid OAuth authorization request.");
    if (
      !isAllowedRedirect(client, input.redirectUri) ||
      !client.audiences.includes(input.audience) ||
      input.scopes.length === 0 ||
      input.scopes.some((scope) => !client.allowedScopes.includes(scope))
    )
      throw new Error("Invalid OAuth authorization request.");
    const identity = await this.authority.assertCurrent(input);
    if (!identity.active || (input.scopes.includes("eventforge:review") && !identity.mfaVerified))
      throw new Error("Authorization denied.");
    const code = opaque();
    await this.grants.putCode({
      value: code,
      clientId: client.id,
      redirectUri: input.redirectUri,
      actorId: input.actorId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      audience: input.audience,
      scopes: [...new Set(input.scopes)],
      challenge: input.codeChallenge,
      expiresAt: this.now() + CODE_TTL_MS,
    });
    return { code, expiresIn: CODE_TTL_MS / 1000 };
  }

  async exchangeCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<TokenResponse> {
    const code = await this.grants.takeCode(input.code);
    if (
      !code ||
      code.expiresAt + SKEW_MS < this.now() ||
      code.clientId !== input.clientId ||
      code.redirectUri !== input.redirectUri ||
      !equals(code.challenge, pkceS256(input.codeVerifier))
    )
      throw new Error("Invalid authorization code.");
    return this.issue(code, opaque());
  }

  async refresh(input: {
    refreshToken: string;
    clientId: string;
    audience: string;
    workspaceId: string;
    scopes?: OAuthScope[];
  }): Promise<TokenResponse> {
    const existing = await this.grants.token(input.refreshToken);
    if (
      !existing ||
      existing.kind !== "refresh" ||
      existing.clientId !== input.clientId ||
      existing.audience !== input.audience ||
      existing.workspaceId !== input.workspaceId
    )
      throw new Error("Invalid refresh token.");
    const active = this.#refreshLocks.get(existing.familyId);
    if (active) return active;
    const operation = this.rotate(existing, input.scopes);
    this.#refreshLocks.set(existing.familyId, operation);
    try {
      return await operation;
    } finally {
      this.#refreshLocks.delete(existing.familyId);
    }
  }

  async authenticate(input: {
    accessToken: string;
    audience: string;
    workspaceId: string;
    requiredScope: OAuthScope;
  }) {
    const token = await this.grants.token(input.accessToken);
    if (
      !token ||
      token.kind !== "access" ||
      token.revoked ||
      token.expiresAt + SKEW_MS < this.now() ||
      token.audience !== input.audience ||
      token.workspaceId !== input.workspaceId ||
      !token.scopes.includes(input.requiredScope)
    )
      throw new Error("Unauthorized.");
    let identity: { active: boolean; mfaVerified: boolean };
    try {
      identity = await this.authority.assertCurrent(token);
    } catch {
      throw new Error("Unauthorized.");
    }
    if (!identity.active || (input.requiredScope === "eventforge:review" && !identity.mfaVerified))
      throw new Error("Unauthorized.");
    return {
      actorId: token.actorId,
      workspaceId: token.workspaceId,
      clientId: token.clientId,
      scopes: token.scopes,
    };
  }

  private async rotate(token: TokenRecord, requestedScopes?: OAuthScope[]): Promise<TokenResponse> {
    if (token.revoked || token.used || token.expiresAt + SKEW_MS < this.now()) {
      await this.grants.revokeFamily(token.familyId);
      this.securityEvents.refreshReuse(token.workspaceId);
      throw new Error("Invalid refresh token.");
    }
    if (
      requestedScopes &&
      (requestedScopes.length === 0 ||
        requestedScopes.some((scope) => !token.scopes.includes(scope)))
    )
      throw new Error("Refresh cannot expand scopes.");
    token.used = true;
    return this.issue(
      { ...token, scopes: requestedScopes ?? token.scopes, challenge: "", redirectUri: "" },
      token.familyId,
    );
  }

  private async issue(
    subject: Omit<AuthorizationCode, "value" | "expiresAt">,
    familyId: string,
  ): Promise<TokenResponse> {
    const accessToken = opaque();
    const refreshToken = opaque();
    const now = this.now();
    await this.grants.putToken({
      value: accessToken,
      kind: "access",
      clientId: subject.clientId,
      actorId: subject.actorId,
      sessionId: subject.sessionId,
      workspaceId: subject.workspaceId,
      audience: subject.audience,
      scopes: subject.scopes,
      familyId,
      expiresAt: now + ACCESS_TTL_MS,
      revoked: false,
      used: false,
    });
    await this.grants.putToken({
      value: refreshToken,
      kind: "refresh",
      clientId: subject.clientId,
      actorId: subject.actorId,
      sessionId: subject.sessionId,
      workspaceId: subject.workspaceId,
      audience: subject.audience,
      scopes: subject.scopes,
      familyId,
      expiresAt: now + REFRESH_TTL_MS,
      revoked: false,
      used: false,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: ACCESS_TTL_MS / 1000,
      scope: subject.scopes.join(" "),
    };
  }
}

export type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  scope: string;
};
