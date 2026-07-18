import { describe, expect, it } from "vitest";
import { isAllowedNavigation, isSafeExternalUrl } from "../src/security.js";

describe("desktop navigation policy", () => {
  it("only delegates HTTPS links to the operating system", () => {
    expect(isSafeExternalUrl("https://eventforge.dev/docs")).toBe(true);
    expect(isSafeExternalUrl("http://eventforge.dev/docs")).toBe(false);
    expect(isSafeExternalUrl("file:///tmp/secret")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });

  it("keeps development navigation on the configured origin", () => {
    expect(isAllowedNavigation("http://localhost:5173/console", "http://localhost:5173")).toBe(
      true,
    );
    expect(isAllowedNavigation("http://localhost:5174/console", "http://localhost:5173")).toBe(
      false,
    );
    expect(isAllowedNavigation("file:///app/index.html", "http://localhost:5173")).toBe(false);
  });

  it("allows local files only in packaged mode", () => {
    const renderer = "file:///Applications/EventForge/resources/console/index.html";
    expect(isAllowedNavigation(`${renderer}#console`, undefined, renderer)).toBe(true);
    expect(isAllowedNavigation("file:///etc/passwd", undefined, renderer)).toBe(false);
    expect(isAllowedNavigation("https://eventforge.dev/console", undefined, renderer)).toBe(false);
    expect(isAllowedNavigation("not a url", undefined, renderer)).toBe(false);
  });
});
