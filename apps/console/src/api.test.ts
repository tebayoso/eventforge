import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.eventforgeDesktop;
});

describe("console API", () => {
  it("loads dashboard events from the configured control plane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })),
    );
    await expect(api.events()).resolves.toEqual([]);
  });

  it("rejects a response that does not satisfy the runtime event contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "event-1" }]), { status: 200 })),
    );
    await expect(api.events()).rejects.toThrow("event.provider");
  });

  it("preserves the HTTP status in a typed error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("stale decision", { status: 409 })),
    );
    const operation = api.decideAction("action-1", true);
    await expect(operation).rejects.toMatchObject({ status: 409, message: "stale decision" });
  });

  it("lets the server derive reviewer identity and sends an idempotency key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await api.decideAction("action/1", true);
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/actions/action%2F1/decision");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
    expect(new Headers(init.headers).get("idempotency-key")).toMatch(/^action:action\/1:/);
  });

  it("routes desktop requests through the constrained preload bridge", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, body: "[]" });
    window.eventforgeDesktop = {
      localDaemonUrl: "http://127.0.0.1:4311",
      controlPlaneUrl: "http://127.0.0.1:4310",
      platform: "darwin",
      request,
    };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(api.events()).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith("/events", expect.objectContaining({ method: undefined }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
