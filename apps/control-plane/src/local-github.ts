import { randomBytes } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const DEFAULT_ORIGIN = "http://127.0.0.1:4310";
const DEFAULT_WEBHOOK_PATH = "/webhooks/github";
const QUICK_TUNNEL_TIMEOUT_MS = 30_000;
const QUICK_TUNNEL_ATTEMPTS = 3;
const QUICK_TUNNEL_RETRY_DELAY_MS = 1_000;
const TUNNEL_READY_TIMEOUT_MS = 30_000;
const GITHUB_WEBHOOK_EVENTS = ["check_run", "issues"] as const;

type StoredWebhook = {
  repository: string;
  hookId: number;
  publicUrl?: string;
  tunnel?: "cloudflare_quick";
};
type GitHubHook = { id: number; config?: { url?: string } };

export type LocalGitHubWebhook = {
  repository: string;
  publicUrl: string;
  hookId: number;
  close: () => Promise<void>;
};

export function envValue(contents: string, key: string): string | undefined {
  const match = contents.match(new RegExp(`^${key}=([^\\r\\n]*)$`, "m"));
  return match?.[1] || undefined;
}

export function webhookFormArgs(relayUrl: string, secret: string): string[] {
  return [
    "-f",
    "name=web",
    "-F",
    "active=true",
    ...GITHUB_WEBHOOK_EVENTS.flatMap((event) => ["-f", `events[]=${event}`]),
    "-f",
    `config[url]=${relayUrl}`,
    "-f",
    "config[content_type]=json",
    "-f",
    `config[secret]=${secret}`,
    "-f",
    "config[insecure_ssl]=0",
  ];
}

export function quickTunnelUrl(output: string): string | undefined {
  return output.match(
    /https:\/\/(?!api\.trycloudflare\.com\b)[-a-z0-9]+\.trycloudflare\.com\b/i,
  )?.[0];
}

export function publicWebhookUrl(tunnelUrl: string, webhookPath = DEFAULT_WEBHOOK_PATH): string {
  return new URL(webhookPath, `${tunnelUrl}/`).toString();
}

export function quickTunnelArgs(originUrl: string, configPath = devNull): string[] {
  return ["--config", configPath, "tunnel", "--url", originUrl];
}

async function command(args: string[]): Promise<string> {
  const result = await execFile("gh", args, { maxBuffer: 1_000_000 });
  return result.stdout.trim();
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function ensureSecret(envPath: string): Promise<string> {
  const current = await readOptional(envPath);
  const existing = envValue(current, "GITHUB_WEBHOOK_SECRET");
  if (existing) return existing;

  const secret = randomBytes(32).toString("base64url");
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  await mkdir(dirname(envPath), { recursive: true });
  await writeFile(envPath, `${current}${prefix}GITHUB_WEBHOOK_SECRET=${secret}\n`, { mode: 0o600 });
  await chmod(envPath, 0o600);
  return secret;
}

async function loadStoredWebhook(statePath: string): Promise<StoredWebhook | undefined> {
  const contents = await readOptional(statePath);
  if (!contents) return undefined;
  try {
    const parsed = JSON.parse(contents) as StoredWebhook;
    return typeof parsed.repository === "string" && Number.isInteger(parsed.hookId)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

async function hookExists(repository: string, hookId: number): Promise<boolean> {
  try {
    const response = await command(["api", `repos/${repository}/hooks/${hookId}`]);
    const hook = JSON.parse(response) as GitHubHook;
    return hook.id === hookId;
  } catch {
    return false;
  }
}

async function createHook(repository: string, relayUrl: string, secret: string): Promise<number> {
  try {
    const response = await command([
      "api",
      "--method",
      "POST",
      `repos/${repository}/hooks`,
      ...webhookFormArgs(relayUrl, secret),
    ]);
    const hook = JSON.parse(response) as GitHubHook;
    if (!Number.isInteger(hook.id)) throw new Error("GitHub created a webhook without an id.");
    return hook.id;
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(
      stderr
        ? `Could not register the GitHub webhook: ${stderr}`
        : "Could not register the GitHub webhook.",
    );
  }
}

async function patchHook(
  repository: string,
  hookId: number,
  publicUrl: string,
  secret: string,
): Promise<void> {
  try {
    await command([
      "api",
      "--method",
      "PATCH",
      `repos/${repository}/hooks/${hookId}`,
      ...webhookFormArgs(publicUrl, secret),
    ]);
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(
      stderr
        ? `Could not update the GitHub webhook: ${stderr}`
        : "Could not update the GitHub webhook.",
    );
  }
}

async function startQuickTunnelAttempt(
  originUrl: string,
  cloudflaredBin: string,
  configPath?: string,
): Promise<{ tunnelUrl: string; close: () => Promise<void> }> {
  const tunnel = spawn(cloudflaredBin, quickTunnelArgs(originUrl, configPath), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  let tunnelUrl: string | undefined;
  let settle: ((value: { tunnelUrl: string; close: () => Promise<void> }) => void) | undefined;
  let fail: ((reason: Error) => void) | undefined;
  const ready = new Promise<{ tunnelUrl: string; close: () => Promise<void> }>(
    (resolve, reject) => {
      settle = resolve;
      fail = reject;
    },
  );
  const finish = () =>
    settle?.({
      tunnelUrl: tunnelUrl!,
      close: async () => {
        if (tunnel.exitCode !== null || tunnel.killed) return;
        tunnel.kill("SIGTERM");
        await Promise.race([
          once(tunnel, "exit"),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
        if (tunnel.exitCode === null) tunnel.kill("SIGKILL");
      },
    });
  const inspect = (chunk: Buffer) => {
    const text = chunk.toString();
    output.push(text);
    tunnelUrl ??= quickTunnelUrl(text);
    if (tunnelUrl) finish();
  };
  tunnel.stdout.on("data", inspect);
  tunnel.stderr.on("data", inspect);
  tunnel.once("error", (error) =>
    fail?.(
      new Error(
        `Could not start ${cloudflaredBin}: ${error.message}. Install cloudflared and retry.`,
      ),
    ),
  );
  tunnel.once("exit", (code, signal) => {
    if (!tunnelUrl)
      fail?.(
        new Error(
          `Cloudflare Quick Tunnel exited before publishing a URL (code ${code ?? "unknown"}, signal ${signal ?? "none"}): ${output.join("").trim()}`,
        ),
      );
  });
  const timeout = setTimeout(() => {
    if (!tunnelUrl) {
      tunnel.kill("SIGTERM");
      fail?.(
        new Error(
          `Cloudflare Quick Tunnel did not publish a URL within ${QUICK_TUNNEL_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }
  }, QUICK_TUNNEL_TIMEOUT_MS);
  try {
    return await ready;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForQuickTunnel(
  originUrl: string,
  cloudflaredBin: string,
  configPath?: string,
): Promise<{ tunnelUrl: string; close: () => Promise<void> }> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= QUICK_TUNNEL_ATTEMPTS; attempt += 1) {
    try {
      return await startQuickTunnelAttempt(originUrl, cloudflaredBin, configPath);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Cloudflare Quick Tunnel failed to start.");
      if (attempt < QUICK_TUNNEL_ATTEMPTS)
        await new Promise((resolve) => setTimeout(resolve, QUICK_TUNNEL_RETRY_DELAY_MS));
    }
  }
  throw new Error(
    `Cloudflare Quick Tunnel failed after ${QUICK_TUNNEL_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

async function waitForTunnelHealth(tunnelUrl: string): Promise<void> {
  const healthUrl = new URL("/health", `${tunnelUrl}/`);
  const deadline = Date.now() + TUNNEL_READY_TIMEOUT_MS;
  let lastStatus = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : "connection failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Cloudflare Quick Tunnel did not reach ${healthUrl} within ${TUNNEL_READY_TIMEOUT_MS / 1000} seconds (${lastStatus}).`,
  );
}

/**
 * Starts a Cloudflare Quick Tunnel for the local control plane and patches the
 * saved GitHub check_run webhook on every launch. Quick Tunnel hostnames are
 * intentionally short-lived, while the GitHub webhook and signing secret persist.
 */
export async function startLocalGitHubWebhook(
  options: {
    rootDir?: string;
    legacyRootDirs?: string[];
    repository?: string;
    originUrl?: string;
    webhookPath?: string;
    cloudflaredBin?: string;
    cloudflaredConfig?: string;
    log?: (message: string) => void;
  } = {},
): Promise<LocalGitHubWebhook> {
  const rootDir = options.rootDir ?? process.cwd();
  const envPath = join(rootDir, ".env");
  const statePath = join(rootDir, ".eventforge", "github-local-webhook.json");
  const stored =
    (await loadStoredWebhook(statePath)) ??
    (
      await Promise.all(
        (options.legacyRootDirs ?? []).map((legacyRootDir) =>
          loadStoredWebhook(join(legacyRootDir, ".eventforge", "github-local-webhook.json")),
        ),
      )
    ).find(Boolean);
  const repository =
    options.repository ??
    process.env.EVENTFORGE_GITHUB_REPOSITORY ??
    (await command(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]));
  if (!repository.includes("/"))
    throw new Error(
      "Could not determine the GitHub repository. Set EVENTFORGE_GITHUB_REPOSITORY=owner/repository.",
    );
  process.env.EVENTFORGE_GITHUB_REPOSITORY = repository;

  const originUrl =
    options.originUrl ?? process.env.EVENTFORGE_LOCAL_TUNNEL_ORIGIN ?? DEFAULT_ORIGIN;
  const tunnel = await waitForQuickTunnel(
    originUrl,
    options.cloudflaredBin ?? process.env.EVENTFORGE_CLOUDFLARED_BIN ?? "cloudflared",
    options.cloudflaredConfig ?? process.env.EVENTFORGE_CLOUDFLARED_CONFIG,
  );
  try {
    await waitForTunnelHealth(tunnel.tunnelUrl);
    const webhookUrl = publicWebhookUrl(tunnel.tunnelUrl, options.webhookPath);
    const secret = await ensureSecret(envPath);
    process.env.GITHUB_WEBHOOK_SECRET = secret;

    const isReusable =
      stored?.repository === repository && (await hookExists(repository, stored.hookId));
    const hookId = isReusable ? stored.hookId : await createHook(repository, webhookUrl, secret);
    if (isReusable) await patchHook(repository, hookId, webhookUrl, secret);
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      `${JSON.stringify({ repository, hookId, publicUrl: webhookUrl, tunnelUrl: tunnel.tunnelUrl, tunnel: "cloudflare_quick" }, null, 2)}\n`,
      { mode: 0o600 },
    );

    options.log?.(
      `GitHub webhook #${hookId} now targets ${webhookUrl} through Cloudflare Quick Tunnel ${tunnel.tunnelUrl}, forwarding to ${originUrl}.`,
    );

    return { repository, publicUrl: webhookUrl, hookId, close: tunnel.close };
  } catch (error) {
    await tunnel.close();
    throw error;
  }
}

export const localWebhookStatePath = (rootDir = process.cwd()) =>
  resolve(rootDir, ".eventforge", "github-local-webhook.json");
