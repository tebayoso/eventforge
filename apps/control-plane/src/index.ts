import "dotenv/config";
import { createApp } from "./app.js";
import { startLocalGitHubWebhook } from "./local-github.js";

const app = await createApp();
const port = Number(process.env.PORT ?? 4310);
if (process.env.EVENTFORGE_GITHUB_LOCAL_WEBHOOK === "true") {
  const localWebhook = await startLocalGitHubWebhook({
    targetUrl: process.env.EVENTFORGE_LOCAL_WEBHOOK_TARGET ?? `http://127.0.0.1:${port}/webhooks/github`,
    log: (message) => app.log.info(message)
  });
  app.addHook("onClose", async () => { await localWebhook.close(); });
}
await app.listen({ host: "0.0.0.0", port });
