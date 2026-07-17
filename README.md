# EventForge

EventForge is a hybrid, policy-first operations console for event-driven Codex workflows. It receives GitHub, Linear, and Sentry events, creates bounded agent runs, preserves scoped memory, and requires explicit approval for consequential actions.

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm test
pnpm dev
pnpm dev:console
```

Open `http://localhost:5173`, then select **Run GitHub CI demo**. The control plane is at `http://localhost:4310`.

`docker compose up -d` starts PostgreSQL/pgvector, MinIO, and the control plane once its image is built. Provider OAuth credentials are never included in this repository; demo events exercise the same normalized event flow without them.

## Test a real GitHub webhook through Cloudflare locally

GitHub cannot deliver a webhook directly to `localhost`, so EventForge starts a local Cloudflare Quick Tunnel. Starting GitHub mode creates a random local webhook secret in the ignored `.env`, creates (or reuses) exactly one `check_run` webhook through the authenticated `gh` CLI, and patches that webhook to the newly created `trycloudflare.com` URL on every launch. The tunnel forwards signed deliveries to the control plane.

```bash
cp .env.example .env
pnpm install
pnpm dev:github
pnpm dev:console
```

`cloudflared` must be on your `PATH` (for macOS: `brew install cloudflared`). Set `EVENTFORGE_CLOUDFLARED_BIN` if it is installed elsewhere. EventForge intentionally starts Quick Tunnels with an empty Cloudflare configuration so unrelated named-tunnel files cannot alter the local webhook route; set `EVENTFORGE_CLOUDFLARED_CONFIG` only when you explicitly need a different config.

Leave both processes running, then open `http://localhost:5173`. Use the **EventForge CI failure demo** GitHub Actions workflow's **Run workflow** button, or dispatch it from the terminal:

```bash
gh workflow run "EventForge CI failure demo" --repo OWNER/REPOSITORY
```

The workflow fails intentionally. Once GitHub finishes it, the console shows a verified GitHub event, a bounded agent investigation, and an approval-gated remediation proposal. You can inspect the raw local event stream with `curl http://127.0.0.1:4310/events`. The public webhook endpoint and webhook id are stored in ignored `.eventforge/github-local-webhook.json`; remove the corresponding repository webhook in GitHub when you are done. Quick Tunnels are for local testing only, never production traffic.

## Packages

- `apps/control-plane` — webhook relay, workflow/policy engine, agent-run orchestration, audit API.
- `apps/console` — React operations console; the Electron shell embeds this surface.
- `apps/desktop` — local Electron companion and private SQLite/LanceDB memory daemon.
- `packages/core` — contracts, signature verification, policy evaluation, memory, and guarded forge logic.
- `packages/mcp-server` — Codex MCP server that controls the local/cloud EventForge API.
- `plugins/eventforge` — native Codex plugin manifest, MCP registration, skill, and opt-in hook.

## Safety model

Incoming provider data is untrusted. EventForge verifies signatures, deduplicates deliveries, redacts secrets, and treats generated connectors as untrusted until validation and explicit approval. All workflow writes default to `approval_required`; workflow owners can grant narrow policies later.
