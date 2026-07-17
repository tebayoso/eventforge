import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";
import { startLocalGitHubWebhook } from "./local-github.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(packageRoot, "../..");
dotenv.config({ path: resolve(projectRoot, ".env") });
process.env.EVENTFORGE_CODEX_WORKDIR ??= projectRoot;

const app = await createApp();
const port = Number(process.env.PORT ?? 4310);
let localWebhook: Awaited<ReturnType<typeof startLocalGitHubWebhook>> | undefined;
app.addHook("onClose", async () => { await localWebhook?.close(); });
await app.listen({ host: "0.0.0.0", port });
if (process.env.EVENTFORGE_GITHUB_LOCAL_WEBHOOK === "true") {
  try {
    localWebhook = await startLocalGitHubWebhook({
      rootDir: projectRoot,
      legacyRootDirs: [packageRoot],
      originUrl: process.env.EVENTFORGE_LOCAL_TUNNEL_ORIGIN ?? `http://127.0.0.1:${port}`,
      log: (message) => app.log.info(message)
    });
  } catch (error) {
    await app.close();
    throw error;
  }
}
