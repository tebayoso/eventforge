// Health-only by design: this trusted-optional hook never starts processes or changes configuration.
const endpoint = process.env.EVENTFORGE_API_URL ?? "http://127.0.0.1:4310";
try {
  const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(750) });
  if (!response.ok) process.exitCode = 0;
} catch {
  // EventForge may be started later. A health check must never block a Codex session.
  process.exitCode = 0;
}
