import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  startWebhook: vi.fn(),
  listen: vi.fn(),
  addHook: vi.fn(),
  close: vi.fn(),
  dotenv: vi.fn(),
  info: vi.fn(),
}));
vi.mock("dotenv", () => ({ default: { config: mocks.dotenv } }));
vi.mock("../src/app.js", () => ({ createApp: mocks.createApp }));
vi.mock("../src/local-github.js", () => ({ startLocalGitHubWebhook: mocks.startWebhook }));

describe("control-plane entrypoint", () => {
  afterEach(() => {
    delete process.env.EVENTFORGE_GITHUB_LOCAL_WEBHOOK;
    delete process.env.EVENTFORGE_RUNTIME_MODE;
    delete process.env.EVENTFORGE_HOST;
    delete process.env.PORT;
  });

  it("starts the compiled service on the configured local port", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.PORT = "4321";
    mocks.createApp.mockResolvedValue({
      listen: mocks.listen,
      addHook: mocks.addHook,
      close: mocks.close,
      log: { info: mocks.info },
    });
    await import("../src/index.js");
    expect(mocks.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 4321 });
    expect(mocks.startWebhook).not.toHaveBeenCalled();
  });

  it("starts and registers the optional local GitHub webhook", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.EVENTFORGE_GITHUB_LOCAL_WEBHOOK = "true";
    mocks.createApp.mockResolvedValue({
      listen: mocks.listen,
      addHook: mocks.addHook,
      close: mocks.close,
      log: { info: mocks.info },
    });
    mocks.startWebhook.mockResolvedValue({
      close: vi.fn(),
      hookId: 1,
      publicBaseUrl: "https://relay.example",
      publicUrl: "https://relay.example/webhooks/github",
    });
    await import("../src/index.js");
    expect(mocks.startWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ originUrl: "http://127.0.0.1:4310", log: expect.any(Function) }),
    );
    const log = mocks.startWebhook.mock.calls[0]![0].log;
    log("registered");
    expect(mocks.info).toHaveBeenCalledWith("registered");
  });
});
