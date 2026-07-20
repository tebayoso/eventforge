import { describe, expect, it } from "vitest";
import worker, { isConsolePath } from "./worker.js";

describe("hosted console route boundary", () => {
  it("protects the console document and every nested console route", () => {
    expect(isConsolePath("/console")).toBe(true);
    expect(isConsolePath("/console/settings")).toBe(true);
    expect(isConsolePath("/console-public")).toBe(false);
    expect(isConsolePath("/")).toBe(false);
  });

  it("negotiates Markdown and publishes discovery links on the public homepage", async () => {
    const assets = { fetch: async () => new Response("<html>homepage</html>") };
    const markdown = await worker.fetch(
      new Request("https://eventforge.dev/", { headers: { accept: "text/markdown" } }),
      { ASSETS: assets },
    );
    expect(markdown.headers.get("content-type")).toContain("text/markdown");
    expect(await markdown.text()).toContain("# EventForge");

    const homepage = await worker.fetch(new Request("https://eventforge.dev/"), { ASSETS: assets });
    expect(homepage.headers.get("link")).toContain('rel="sitemap"');
  });
});
