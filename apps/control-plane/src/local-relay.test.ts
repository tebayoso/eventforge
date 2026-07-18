import { describe, expect, it, vi } from "vitest";
import { LocalRelayController } from "./local-relay.js";

describe("local relay controller", () => {
  it("starts once and returns provider-specific endpoints", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue({
      repository: "owner/repo",
      publicUrl: "https://calm-river-birch.eventforge.dev/webhooks/github",
      publicBaseUrl: "https://calm-river-birch.eventforge.dev",
      tunnelName: "eventforge-calm-river-birch",
      hookId: 42,
      close,
    });
    const controller = new LocalRelayController(start);
    await expect(controller.ensure("github")).resolves.toMatchObject({
      state: "ready",
      endpoint: "https://calm-river-birch.eventforge.dev/webhooks/github",
    });
    await expect(controller.ensure("linear")).resolves.toMatchObject({
      state: "ready",
      endpoint: "https://calm-river-birch.eventforge.dev/webhooks/linear",
    });
    expect(start).toHaveBeenCalledTimes(1);
    await controller.close();
    expect(close).toHaveBeenCalledOnce();
    expect(controller.status()).toEqual({ state: "stopped" });
  });

  it("coalesces concurrent startup and reports a safe failed state", async () => {
    const active = {
      repository: "owner/repo",
      publicUrl: "https://calm-river-birch.eventforge.dev/webhooks/github",
      publicBaseUrl: "https://calm-river-birch.eventforge.dev",
      tunnelName: "eventforge-calm-river-birch",
      hookId: 42,
      close: vi.fn().mockResolvedValue(undefined),
    };
    let resolveStart!: (value: typeof active) => void;
    const start = vi.fn(() => new Promise<typeof active>((resolve) => (resolveStart = resolve)));
    const controller = new LocalRelayController(start);
    const first = controller.ensure("github");
    const second = controller.ensure("github");
    expect(controller.status()).toMatchObject({ state: "starting" });
    expect(start).toHaveBeenCalledTimes(1);
    resolveStart(active);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    const failure = new LocalRelayController(async () => {
      throw new Error("credential detail");
    });
    await expect(failure.ensure("github")).rejects.toThrow("credential detail");
    expect(failure.status()).toEqual({
      state: "failed",
      provider: "github",
      error: "Local relay failed to start.",
    });
  });
});
