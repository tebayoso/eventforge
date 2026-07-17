import { describe, expect, it, vi } from "vitest";
import { EventForgeApi } from "../src/client.js";

describe("EventForgeApi", () => {
  it("sends JSON to the local control plane", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = new EventForgeApi("http://localhost:4310");
    await expect(api.post("/forge", { prompt: "Build a safe connector" })).resolves.toEqual({ ok: true });
    expect(mock).toHaveBeenCalledWith(new URL("/forge", "http://localhost:4310"), expect.objectContaining({ method: "POST" }));
    mock.mockRestore();
  });
});
