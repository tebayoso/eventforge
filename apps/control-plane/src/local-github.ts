import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import SmeeClient from "smee-client";

const execFile = promisify(execFileCallback);
const DEFAULT_TARGET = "http://127.0.0.1:4310/webhooks/github";

type StoredRelay = { repository: string; relayUrl: string; hookId: number };
type GitHubHook = { id: number; config?: { url?: string } };

export type LocalGitHubWebhook = {
  repository: string;
  relayUrl: string;
  hookId: number;
  close: () => Promise<void>;
};

export function envValue(contents: string, key: string): string | undefined {
  const match = contents.match(new RegExp(`^${key}=([^\\r\\n]*)$`, "m"));
  return match?.[1] || undefined;
}

export function webhookFormArgs(relayUrl: string, secret: string): string[] {
  return [
    "-f", "name=web",
    "-f", "active=true",
    "-f", "events[]=check_run",
    "-f", `config[url]=${relayUrl}`,
    "-f", "config[content_type]=json",
    "-f", `config[secret]=${secret}`,
    "-f", "config[insecure_ssl]=0"
  ];
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

async function provisionRelay(existing?: string): Promise<string> {
  if (existing) return existing;
  try {
    return await SmeeClient.createChannel();
  } catch {
    throw new Error("Could not provision a Smee relay. Set EVENTFORGE_GITHUB_RELAY_URL to an https://smee.io/<channel> URL and try again.");
  }
}

async function loadStoredRelay(statePath: string): Promise<StoredRelay | undefined> {
  const contents = await readOptional(statePath);
  if (!contents) return undefined;
  try {
    const parsed = JSON.parse(contents) as StoredRelay;
    return typeof parsed.repository === "string" && typeof parsed.relayUrl === "string" && Number.isInteger(parsed.hookId) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function hookExists(repository: string, hookId: number, relayUrl: string): Promise<boolean> {
  try {
    const response = await command(["api", `repos/${repository}/hooks/${hookId}`]);
    const hook = JSON.parse(response) as GitHubHook;
    return hook.id === hookId && hook.config?.url === relayUrl;
  } catch {
    return false;
  }
}

async function createHook(repository: string, relayUrl: string, secret: string): Promise<number> {
  const response = await command(["api", "--method", "POST", `repos/${repository}/hooks`, ...webhookFormArgs(relayUrl, secret)]);
  const hook = JSON.parse(response) as GitHubHook;
  if (!Number.isInteger(hook.id)) throw new Error("GitHub created a webhook without an id.");
  return hook.id;
}

/**
 * Creates a private local development relay and registers GitHub's signed check_run
 * deliveries against it. The relay URL is intentionally stored outside Git so a
 * restart reuses one webhook instead of creating duplicates.
 */
export async function startLocalGitHubWebhook(options: {
  rootDir?: string;
  repository?: string;
  relayUrl?: string;
  targetUrl?: string;
  log?: (message: string) => void;
} = {}): Promise<LocalGitHubWebhook> {
  const rootDir = options.rootDir ?? process.cwd();
  const envPath = join(rootDir, ".env");
  const statePath = join(rootDir, ".eventforge", "github-local-webhook.json");
  const stored = await loadStoredRelay(statePath);
  const repository = options.repository ?? process.env.EVENTFORGE_GITHUB_REPOSITORY ?? (await command(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]));
  if (!repository.includes("/")) throw new Error("Could not determine the GitHub repository. Set EVENTFORGE_GITHUB_REPOSITORY=owner/repository.");

  const relayUrl = await provisionRelay(options.relayUrl ?? process.env.EVENTFORGE_GITHUB_RELAY_URL ?? (stored?.repository === repository ? stored.relayUrl : undefined));
  const secret = await ensureSecret(envPath);
  process.env.GITHUB_WEBHOOK_SECRET = secret;

  const isReusable = stored?.repository === repository && stored.relayUrl === relayUrl && await hookExists(repository, stored.hookId, relayUrl);
  const hookId = isReusable ? stored.hookId : await createHook(repository, relayUrl, secret);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify({ repository, relayUrl, hookId }, null, 2)}\n`, { mode: 0o600 });

  const targetUrl = options.targetUrl ?? process.env.EVENTFORGE_LOCAL_WEBHOOK_TARGET ?? DEFAULT_TARGET;
  const smee = new SmeeClient({ source: relayUrl, target: targetUrl, logger: console });
  const events = smee.start();
  options.log?.(`GitHub webhook #${hookId} is registered for ${repository}; forwarding through ${relayUrl} to ${targetUrl}.`);

  return { repository, relayUrl, hookId, close: async () => { events.close(); } };
}

export const localWebhookStatePath = (rootDir = process.cwd()) => resolve(rootDir, ".eventforge", "github-local-webhook.json");
