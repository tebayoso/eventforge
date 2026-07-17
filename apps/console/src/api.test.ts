import { describe, expect, it, vi } from "vitest";

describe("console API", () => {
  it("loads dashboard events from the configured control plane", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    const { api } = await import("./api");
    await expect(api.events()).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});
