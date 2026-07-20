# EventForge Codex Plugin

This native Codex plugin bundles EventForge skills, an opt-in health-only lifecycle hook, and the `eventforge` MCP server configuration.

The plugin includes a self-contained, compiled MCP server and requires only Node.js 20.11 or newer. The MCP server communicates with the local EventForge daemon/control plane at `EVENTFORGE_API_URL` (default `http://127.0.0.1:4310`).

For a zero-checkout setup, configure the self-starting package directly in Codex:

```bash
codex mcp add eventforge -- npx -y --package github:tebayoso/eventforge eventforge-mcp
```

This launcher starts the local control plane automatically when the default API is unavailable. The repository plugin remains useful when you want an explicitly managed local daemon and its optional lifecycle hook.

Maintainers regenerate and verify the bundled server with `pnpm plugin:check`; plugin users do not need a global package or repository checkout.

From a repository checkout, add the local marketplace and install the plugin:

```bash
codex plugin marketplace add .
codex plugin add eventforge@eventforge-local
```

Restart Codex after installation so a new task discovers the bundled MCP tools. During development, rerun `pnpm plugin:check` before reinstalling so the committed server bundle matches its TypeScript source.

The bundled lifecycle hook is intentionally optional and side-effect free. Trust it only after reviewing `hooks/session-start.mjs`. Declining it does not disable the MCP tools. The hook performs only a bounded `GET /health`; it never launches EventForge, changes configuration, or approves actions.

For a guided view of the local dashboard, GitHub event relay, and Codex review flow, watch the [EventForge demo video](https://youtu.be/pht3rrl--pE).
