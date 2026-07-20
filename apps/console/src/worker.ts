interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export function isConsolePath(pathname: string): boolean {
  return pathname === "/console" || pathname.startsWith("/console/");
}

function gatedConsole(): Response {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EventForge sign-in required</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e13;color:#f4f5f7;font:16px/1.5 system-ui,sans-serif}main{max-width:38rem;padding:2rem}p{color:#aab2c0}a{color:#8ee5c2}</style><main><p>EventForge secure console</p><h1>Sign-in is not enabled yet.</h1><p>The hosted console is closed until account authentication and tenant isolation pass their release gates.</p><a href="/">Return to EventForge</a></main></html>',
    {
      status: 503,
      headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" },
    },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (isConsolePath(new URL(request.url).pathname)) return gatedConsole();
    return env.ASSETS.fetch(request);
  },
};
