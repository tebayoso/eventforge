import { describe, expect, it } from "vitest";
import { envValue, localWebhookStatePath, publicWebhookUrl, quickTunnelArgs, quickTunnelUrl, webhookFormArgs } from "./local-github.js";

describe("local GitHub webhook bootstrap", () => {
  it("reads only the requested env entry so the generated secret is never exposed", () => {
    expect(envValue("PORT=4310\nGITHUB_WEBHOOK_SECRET=generated-secret\n", "GITHUB_WEBHOOK_SECRET")).toBe("generated-secret");
    expect(envValue("PORT=4310\n", "GITHUB_WEBHOOK_SECRET")).toBeUndefined();
  });

  it("uses GitHub's signed JSON webhook configuration", () => {
    expect(webhookFormArgs("https://eventforge.trycloudflare.com", "secret")).toEqual(expect.arrayContaining([
      "events[]=check_run", "config[content_type]=json", "config[insecure_ssl]=0", "config[secret]=secret"
    ]));
  });

  it("finds the temporary Cloudflare hostname in either cloudflared output stream", () => {
    expect(quickTunnelUrl("INF | https://eventforge-sky.trycloudflare.com | connected")).toBe("https://eventforge-sky.trycloudflare.com");
    expect(quickTunnelUrl("no public URL yet")).toBeUndefined();
  });

  it("keeps the webhook path when Cloudflare forwards the local origin", () => {
    expect(publicWebhookUrl("https://eventforge-sky.trycloudflare.com")).toBe("https://eventforge-sky.trycloudflare.com/webhooks/github");
  });

  it("isolates Quick Tunnels from an unrelated default cloudflared config", () => {
    expect(quickTunnelArgs("http://127.0.0.1:4310", "/dev/null")).toEqual(["--config", "/dev/null", "tunnel", "--url", "http://127.0.0.1:4310"]);
  });

  it("keeps relay state out of the repository root", () => {
    expect(localWebhookStatePath("/tmp/eventforge")).toBe("/tmp/eventforge/.eventforge/github-local-webhook.json");
  });
});
