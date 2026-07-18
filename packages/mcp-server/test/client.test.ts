import { describe, expect, it, vi } from "vitest";
import { EventForgeApi } from "../src/client.js";

describe("EventForgeApi", () => {
  it("sends JSON to the local control plane", async () => {
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = new EventForgeApi({
      baseUrl: "http://localhost:4310",
      bearerToken: "test-token",
    });
    await expect(api.post("/forge", { prompt: "Build a safe connector" })).resolves.toEqual({
      ok: true,
    });
    expect(mock).toHaveBeenCalledWith(
      new URL("/forge", "http://localhost:4310"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({}),
      }),
    );
    const headers = mock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer test-token");
    mock.mockRestore();
  });

  it("returns a bounded, typed error for non-success responses", async () => {
    const api = new EventForgeApi({
      fetchImpl: vi.fn().mockResolvedValue(new Response("not allowed", { status: 403 })),
    });

    await expect(api.get("/events")).rejects.toMatchObject({
      name: "EventForgeApiError",
      status: 403,
      message: "EventForge API returned 403: not allowed",
    });
  });

  it("does not leak fetch implementation errors", async () => {
    const api = new EventForgeApi({
      fetchImpl: vi.fn().mockRejectedValue(new Error("socket path /private/secret")),
    });

    await expect(api.get("/events")).rejects.toThrow("Unable to reach the EventForge API.");
  });

  it("rejects invalid JSON from an otherwise successful API", async () => {
    const api = new EventForgeApi({
      fetchImpl: vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
    });

    await expect(api.get("/events")).rejects.toThrow("EventForge API returned invalid JSON.");
  });
});
