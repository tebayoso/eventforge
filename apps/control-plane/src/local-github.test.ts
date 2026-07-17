import { describe, expect, it } from "vitest";
import { envValue, localWebhookStatePath, webhookFormArgs } from "./local-github.js";

describe("local GitHub webhook bootstrap", () => {
  it("reads only the requested env entry so the generated secret is never exposed", () => {
    expect(envValue("PORT=4310\nGITHUB_WEBHOOK_SECRET=generated-secret\n", "GITHUB_WEBHOOK_SECRET")).toBe("generated-secret");
    expect(envValue("PORT=4310\n", "GITHUB_WEBHOOK_SECRET")).toBeUndefined();
  });

  it("uses GitHub's signed JSON webhook configuration", () => {
    expect(webhookFormArgs("https://smee.io/example", "secret")).toEqual(expect.arrayContaining([
      "events[]=check_run", "config[content_type]=json", "config[insecure_ssl]=0", "config[secret]=secret"
    ]));
  });

  it("keeps relay state out of the repository root", () => {
    expect(localWebhookStatePath("/tmp/eventforge")).toBe("/tmp/eventforge/.eventforge/github-local-webhook.json");
  });
});
