import { describe, expect, it } from "vitest";
import {
  InMemoryOAuthGrantRepository,
  OAuthAuthorizationService,
  OAuthSecurityEventSink,
  type FirstPartyClient,
  pkceS256,
} from "../src/oauth.js";

const client: FirstPartyClient = {
  id: "codex-desktop",
  name: "Codex Desktop",
  redirectUris: [
    "https://codex.openai.com/oauth/callback",
    "http://127.0.0.1/callback",
    "http://[::1]/callback",
  ],
  audiences: ["https://mcp.eventforge.dev"],
  allowedScopes: ["eventforge:read", "eventforge:review"],
};
const AUDIENCE = "https://mcp.eventforge.dev";
const REDIRECT_URI = "https://codex.openai.com/oauth/callback";
const verifier = "a".repeat(43);
function service(active = true, mfaVerified = true) {
  const events = new OAuthSecurityEventSink();
  return {
    events,
    service: new OAuthAuthorizationService(
      [client],
      new InMemoryOAuthGrantRepository(),
      { assertCurrent: async () => ({ active, mfaVerified }) },
      events,
    ),
  };
}
async function codeFor(
  s: OAuthAuthorizationService,
  workspaceId = "workspace-a",
  scopes: ("eventforge:read" | "eventforge:review")[] = ["eventforge:read"],
) {
  return s.authorize({
    clientId: client.id,
    redirectUri: "https://codex.openai.com/oauth/callback",
    actorId: "user-1",
    sessionId: "session-1",
    workspaceId,
    audience: AUDIENCE,
    scopes,
    codeChallenge: pkceS256(verifier),
    codeChallengeMethod: "S256",
  });
}

describe("OAuth 2.1 authorization domain", () => {
  it("publishes HTTPS protected-resource metadata and only read/review scopes", () => {
    const { service: s } = service();
    expect(s.metadata("https://mcp.eventforge.dev")).toMatchObject({
      scopes_supported: ["eventforge:read", "eventforge:review"],
    });
    expect(() => s.metadata("http://mcp.eventforge.dev")).toThrow("HTTPS");
  });
  it("requires static exact redirects, including literal loopback hosts", async () => {
    const { service: s } = service();
    await expect(
      s.authorize({
        clientId: client.id,
        redirectUri: "http://localhost/callback",
        actorId: "u",
        workspaceId: "w",
        audience: AUDIENCE,
        scopes: ["eventforge:read"],
        codeChallenge: pkceS256(verifier),
        codeChallengeMethod: "S256",
      }),
    ).rejects.toThrow("Invalid");
    await expect(
      s.authorize({
        clientId: client.id,
        redirectUri: "https://codex.openai.com/oauth/callback?x=1",
        actorId: "u",
        workspaceId: "w",
        audience: AUDIENCE,
        scopes: ["eventforge:read"],
        codeChallenge: pkceS256(verifier),
        codeChallengeMethod: "S256",
      }),
    ).rejects.toThrow("Invalid");
  });
  it("binds a single-use code to client, redirect, PKCE, workspace, audience, and selected scopes", async () => {
    const { service: s } = service();
    const code = await codeFor(s);
    await expect(
      s.exchangeCode({
        code: code.code,
        clientId: client.id,
        redirectUri: REDIRECT_URI,
        codeVerifier: "b".repeat(43),
      }),
    ).rejects.toThrow("Invalid authorization code");
    await expect(
      s.exchangeCode({
        code: code.code,
        clientId: client.id,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
      }),
    ).rejects.toThrow("Invalid authorization code");
    const next = await codeFor(s);
    const tokens = await s.exchangeCode({
      code: next.code,
      clientId: client.id,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    expect(tokens.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokens.scope).toBe("eventforge:read");
  });
  it("uses independent workspace grants and validates current membership, audience, scope, and MFA on every access", async () => {
    const { service: s } = service();
    const c = await codeFor(s, "workspace-a", ["eventforge:read", "eventforge:review"]);
    const tokens = await s.exchangeCode({
      code: c.code,
      clientId: client.id,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    await expect(
      s.authenticate({
        accessToken: tokens.accessToken,
        audience: AUDIENCE,
        workspaceId: "workspace-b",
        requiredScope: "eventforge:read",
      }),
    ).rejects.toThrow("Unauthorized");
    await expect(
      s.authenticate({
        accessToken: tokens.accessToken,
        audience: "https://other.example",
        workspaceId: "workspace-a",
        requiredScope: "eventforge:read",
      }),
    ).rejects.toThrow("Unauthorized");
    await expect(
      s.authenticate({
        accessToken: tokens.accessToken,
        audience: AUDIENCE,
        workspaceId: "workspace-a",
        requiredScope: "eventforge:review",
      }),
    ).resolves.toMatchObject({ workspaceId: "workspace-a" });
  });
  it("rotates refreshes once, never expands scope, and revokes the family on reuse", async () => {
    const { service: s, events } = service();
    const c = await codeFor(s);
    const tokens = await s.exchangeCode({
      code: c.code,
      clientId: client.id,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    await expect(
      s.refresh({
        refreshToken: tokens.refreshToken,
        clientId: client.id,
        audience: AUDIENCE,
        workspaceId: "workspace-a",
        scopes: ["eventforge:review"],
      }),
    ).rejects.toThrow("cannot expand");
    const rotated = await s.refresh({
      refreshToken: tokens.refreshToken,
      clientId: client.id,
      audience: AUDIENCE,
      workspaceId: "workspace-a",
    });
    await expect(
      s.refresh({
        refreshToken: tokens.refreshToken,
        clientId: client.id,
        audience: AUDIENCE,
        workspaceId: "workspace-a",
      }),
    ).rejects.toThrow("Invalid refresh token");
    await expect(
      s.authenticate({
        accessToken: rotated.accessToken,
        audience: AUDIENCE,
        workspaceId: "workspace-a",
        requiredScope: "eventforge:read",
      }),
    ).rejects.toThrow("Unauthorized");
    expect(events.events).toEqual([{ workspaceId: "workspace-a", type: "refresh_reuse" }]);
  });
  it("serializes concurrent refresh retries to one successor", async () => {
    const { service: s } = service();
    const c = await codeFor(s);
    const tokens = await s.exchangeCode({
      code: c.code,
      clientId: client.id,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    const request = {
      refreshToken: tokens.refreshToken,
      clientId: client.id,
      audience: AUDIENCE,
      workspaceId: "workspace-a",
    };
    const [first, second] = await Promise.all([s.refresh(request), s.refresh(request)]);
    expect(first.refreshToken).toBe(second.refreshToken);
  });
  it("denies review grants without recent MFA and denies an unavailable identity authority", async () => {
    const { service: noMfa } = service(true, false);
    await expect(codeFor(noMfa, "workspace-a", ["eventforge:review"])).rejects.toThrow(
      "Authorization denied",
    );
    const s = new OAuthAuthorizationService([client], new InMemoryOAuthGrantRepository(), {
      assertCurrent: async () => {
        throw new Error("offline");
      },
    });
    await expect(codeFor(s)).rejects.toThrow("offline");
  });
});
