import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  chmod: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:util", () => ({ promisify: () => mocks.execFile }));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
  chmod: mocks.chmod,
}));
vi.mock("node:child_process", () => ({ execFile: vi.fn(), spawn: mocks.spawn }));

function tunnelProcess(output = "INF https://safe-tunnel.trycloudflare.com ready") {
  const process = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
    killed: boolean;
    kill: (signal: string) => boolean;
  };
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.exitCode = null;
  process.killed = false;
  process.kill = () => {
    process.killed = true;
    process.exitCode = 0;
    queueMicrotask(() => process.emit("exit", 0, null));
    return true;
  };
  queueMicrotask(() => process.stderr.emit("data", Buffer.from(output)));
  return process;
}

describe("local GitHub webhook integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.chmod.mockResolvedValue(undefined);
    mocks.spawn.mockImplementation(() => tunnelProcess());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  it("reuses and patches a stored hook after the tunnel becomes healthy", async () => {
    mocks.readFile.mockImplementation(async (path: string) =>
      path.endsWith(".env")
        ? "GITHUB_WEBHOOK_SECRET=existing-secret\n"
        : JSON.stringify({ repository: "owner/repo", hookId: 42 }),
    );
    mocks.execFile.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes("repos/owner/repo/hooks/42")) return { stdout: JSON.stringify({ id: 42 }) };
      return { stdout: "{}" };
    });
    const { startLocalGitHubWebhook } = await import("./local-github.js");
    const log = vi.fn();
    const result = await startLocalGitHubWebhook({
      rootDir: "/tmp/eventforge-test",
      repository: "owner/repo",
      log,
    });
    expect(result).toMatchObject({
      repository: "owner/repo",
      hookId: 42,
      publicUrl: "https://safe-tunnel.trycloudflare.com/webhooks/github",
    });
    expect(process.env.EVENTFORGE_GITHUB_REPOSITORY).toBe("owner/repo");
    expect(mocks.execFile).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["PATCH", "repos/owner/repo/hooks/42"]),
      expect.anything(),
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("github-local-webhook.json"),
      expect.stringContaining("safe-tunnel.trycloudflare.com"),
      { mode: 0o600 },
    );
    expect(log).toHaveBeenCalled();
    await result.close();
  });

  it("creates a secret and hook when no reusable state exists", async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    mocks.execFile.mockResolvedValue({ stdout: JSON.stringify({ id: 77 }) });
    const { startLocalGitHubWebhook } = await import("./local-github.js");
    const result = await startLocalGitHubWebhook({
      rootDir: "/tmp/eventforge-new",
      repository: "owner/new",
    });
    expect(result.hookId).toBe(77);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".env"),
      expect.stringContaining("GITHUB_WEBHOOK_SECRET="),
      { mode: 0o600 },
    );
    await result.close();
  });

  it("uses a configured named tunnel instead of requesting a random hostname", async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    mocks.execFile.mockResolvedValue({ stdout: JSON.stringify({ id: 80 }) });
    const { startLocalGitHubWebhook } = await import("./local-github.js");
    const result = await startLocalGitHubWebhook({
      rootDir: "/tmp/eventforge-named",
      repository: "owner/repo",
      namedTunnel: "eventforge-local",
      namedTunnelPublicUrl: "https://eventforge-hooks.example.com",
    });
    expect(result.publicUrl).toBe("https://eventforge-hooks.example.com/webhooks/github");
    expect(mocks.spawn).toHaveBeenCalledWith(
      "cloudflared",
      expect.arrayContaining(["run", "eventforge-local"]),
      expect.anything(),
    );
    await result.close();
  });

  it("replaces a published tunnel that never becomes healthy", async () => {
    let unhealthy: ReturnType<typeof tunnelProcess> | undefined;
    mocks.spawn
      .mockImplementationOnce(() => {
        unhealthy = tunnelProcess("INF https://unhealthy-tunnel.trycloudflare.com ready");
        return unhealthy;
      })
      .mockImplementationOnce(() =>
        tunnelProcess("INF https://healthy-tunnel.trycloudflare.com ready"),
      );
    mocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    mocks.execFile.mockResolvedValue({ stdout: JSON.stringify({ id: 79 }) });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: URL) => {
        if (url.hostname === "healthy-tunnel.trycloudflare.com") return { ok: true, status: 200 };
        throw new Error("unreachable edge");
      }),
    );

    const { startLocalGitHubWebhook } = await import("./local-github.js");
    const result = await startLocalGitHubWebhook({
      rootDir: "/tmp/eventforge-retry",
      repository: "owner/repo",
      tunnelReadyTimeoutMs: 1,
    });
    expect(unhealthy?.killed).toBe(true);
    expect(result.publicUrl).toBe("https://healthy-tunnel.trycloudflare.com/webhooks/github");
    await result.close();
  });

  it("closes the tunnel when repository discovery is invalid", async () => {
    const child = tunnelProcess();
    mocks.spawn.mockReturnValue(child);
    mocks.readFile.mockResolvedValue("");
    const { startLocalGitHubWebhook } = await import("./local-github.js");
    await expect(
      startLocalGitHubWebhook({ rootDir: "/tmp/eventforge-invalid", repository: "invalid" }),
    ).rejects.toThrow("Could not determine");
  });

  it("replaces a stored hook that GitHub no longer returns", async () => {
    mocks.readFile.mockImplementation(async (path: string) =>
      path.endsWith(".env")
        ? "PORT=4310\n"
        : JSON.stringify({ repository: "owner/repo", hookId: 41 }),
    );
    mocks.execFile.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes("repos/owner/repo/hooks/41")) throw new Error("not found");
      return { stdout: JSON.stringify({ id: 78 }) };
    });
    const { startLocalGitHubWebhook } = await import("./local-github.js");
    const result = await startLocalGitHubWebhook({
      rootDir: "/tmp/eventforge-replace",
      repository: "owner/repo",
    });
    expect(result.hookId).toBe(78);
    expect(mocks.chmod).toHaveBeenCalled();
    await result.close();
  });

  it("closes the tunnel and surfaces GitHub hook creation errors", async () => {
    let child: ReturnType<typeof tunnelProcess> | undefined;
    mocks.spawn.mockImplementation(() => {
      child = tunnelProcess();
      return child;
    });
    mocks.readFile.mockResolvedValue("");
    mocks.execFile.mockRejectedValue(
      Object.assign(new Error("denied"), { stderr: "permission denied" }),
    );
    const { startLocalGitHubWebhook } = await import("./local-github.js");
    await expect(
      startLocalGitHubWebhook({ rootDir: "/tmp/eventforge-denied", repository: "owner/repo" }),
    ).rejects.toThrow("permission denied");
    expect(child?.killed).toBe(true);
  });

  it("surfaces an invalid stored state and invalid GitHub response safely", async () => {
    mocks.readFile.mockImplementation(async (path: string) =>
      path.endsWith(".env") ? "GITHUB_WEBHOOK_SECRET=secret\n" : "not-json",
    );
    mocks.execFile.mockResolvedValue({ stdout: JSON.stringify({ noId: true }) });
    const { startLocalGitHubWebhook } = await import("./local-github.js");
    await expect(
      startLocalGitHubWebhook({
        rootDir: "/tmp/eventforge-invalid-response",
        repository: "owner/repo",
      }),
    ).rejects.toThrow("Could not register");
  });
});
