// This hook has no side effects: Codex requires users to explicitly trust plugin hooks.
const endpoint = process.env.EVENTFORGE_API_URL ?? "http://127.0.0.1:4310";
try {
  const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(750) });
  if (!response.ok) process.exitCode = 0;
} catch {
  // The MCP server can still be configured later; never start processes or alter user configuration from a hook.
  process.exitCode = 0;
}
