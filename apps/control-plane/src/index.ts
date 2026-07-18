import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";
import { startLocalGitHubWebhook } from "./local-github.js";
import { LocalRelayController } from "./local-relay.js";
import { createTunnelProvisionerFromEnv } from "./managed-tunnel.js";
import { resolveRuntimeConfig } from "./runtime.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(packageRoot, "../..");
dotenv.config({ path: resolve(projectRoot, ".env") });
process.env.EVENTFORGE_CODEX_WORKDIR ??= projectRoot;

const port = Number(process.env.PORT ?? 4310);
const runtime = resolveRuntimeConfig();
const relayController = new LocalRelayController(() =>
  startLocalGitHubWebhook({
    rootDir: projectRoot,
    legacyRootDirs: [packageRoot],
    originUrl: process.env.EVENTFORGE_LOCAL_TUNNEL_ORIGIN ?? `http://127.0.0.1:${port}`,
    log: (message) => app.log.info(message),
  }),
);
const app = await createApp({
  relayController,
  tunnelProvisioner: createTunnelProvisionerFromEnv(),
});
app.addHook("onClose", async () => {
  await relayController.close();
});
await app.listen({ host: runtime.bindHost, port });
if (process.env.EVENTFORGE_GITHUB_LOCAL_WEBHOOK === "true") {
  try {
    await relayController.ensure("github");
  } catch (error) {
    await app.close();
    throw error;
  }
}
