import { createApp } from "../../../apps/control-plane/src/app.js";
import { startLocalGitHubWebhook } from "../../../apps/control-plane/src/local-github.js";
import { LocalRelayController } from "../../../apps/control-plane/src/local-relay.js";
import { createTunnelProvisionerFromEnv } from "../../../apps/control-plane/src/managed-tunnel.js";

const DEFAULT_API_URL = "http://127.0.0.1:4310";

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

async function isEventForgeApi(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", baseUrl), {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: string };
    return body.service === "eventforge-control-plane";
  } catch {
    return false;
  }
}

export type EmbeddedControlPlane = {
  baseUrl: string;
  close: () => Promise<void>;
  started: boolean;
};

export async function ensureEmbeddedControlPlane(): Promise<EmbeddedControlPlane> {
  const baseUrl = process.env.EVENTFORGE_API_URL ?? DEFAULT_API_URL;
  process.env.EVENTFORGE_API_URL = baseUrl;

  if (await isEventForgeApi(baseUrl)) {
    return { baseUrl, close: async () => undefined, started: false };
  }

  const url = new URL(baseUrl);
  if (process.env.EVENTFORGE_AUTO_START === "false" || !isLoopback(url.hostname)) {
    return { baseUrl, close: async () => undefined, started: false };
  }
  if (url.protocol !== "http:") {
    throw new Error("Embedded EventForge requires a loopback HTTP API URL.");
  }

  const port = Number.parseInt(url.port || "4310", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("EVENTFORGE_API_URL must contain a valid loopback port.");
  }

  const workdir = process.env.EVENTFORGE_CODEX_WORKDIR ?? process.cwd();
  process.env.EVENTFORGE_CODEX_WORKDIR = workdir;
  process.env.EVENTFORGE_RUNTIME_MODE = "local";
  process.env.EVENTFORGE_DEMO_MODE ??= "true";
  process.env.EVENTFORGE_RUNNER ??= "demo";
  process.env.EVENTFORGE_HOST = url.hostname === "localhost" ? "localhost" : "127.0.0.1";
  process.env.PORT = String(port);

  const relayController = new LocalRelayController(() =>
    startLocalGitHubWebhook({
      rootDir: workdir,
      legacyRootDirs: [],
      originUrl: process.env.EVENTFORGE_LOCAL_TUNNEL_ORIGIN ?? baseUrl,
      log: (message) => app.log.info(message),
    }),
  );
  const app = await createApp({
    relayController,
    tunnelProvisioner: createTunnelProvisionerFromEnv(),
  });
  app.addHook("onClose", async () => relayController.close());
  await app.listen({ host: process.env.EVENTFORGE_HOST, port });
  console.error(`EventForge started automatically at ${baseUrl}`);

  return { baseUrl, close: () => app.close(), started: true };
}

export function closeEmbeddedControlPlaneOnExit(controlPlane: EmbeddedControlPlane): void {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void controlPlane.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.stdin.once("end", close);
  process.stdin.once("close", close);
}
