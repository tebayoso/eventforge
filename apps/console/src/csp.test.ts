import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve("index.html"), "utf8");
const responseHeaders = readFileSync(resolve("public/_headers"), "utf8");

const analyticsSources = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
  "https://static.cloudflareinsights.com",
  "https://cloudflareinsights.com",
];

describe("console content security policies", () => {
  it("allows the production analytics endpoints in both browser policies", () => {
    for (const source of analyticsSources) {
      expect(indexHtml).toContain(source);
      expect(responseHeaders).toContain(source);
    }
  });

  it("enforces frame ancestors only through the HTTP response header", () => {
    expect(indexHtml).not.toContain("frame-ancestors");
    expect(responseHeaders).toContain("frame-ancestors 'none'");
  });
});
