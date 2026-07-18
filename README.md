# EventForge

EventForge is a hybrid, policy-first operations console for event-driven Codex workflows. It receives GitHub, Linear, and Sentry events, creates bounded agent runs, preserves scoped memory, and requires explicit approval for consequential actions.

## Hackathon submission

- **Code repository:** [github.com/tebayoso/eventforge](https://github.com/tebayoso/eventforge)

### How Codex and GPT-5.6 were used

Codex, using GPT-5.6, was the engineering collaborator for EventForge: it translated the product requirements into the TypeScript monorepo, implemented the event-ingestion, policy, approval, memory, MCP/plugin, and operations-console flows, and ran the test, build, and browser-validation loops.

The product also uses the Codex SDK at runtime. A verified GitHub event can create a persisted, read-only Codex thread that reviews untrusted engineering evidence within the workflow's policy boundary; EventForge records the resulting summary and requires separate approval before any consequential action.

The complete Devpost-ready title, story, tags, installation method, and final-submission checklist are in [workfiles/devpost/SUBMISSION.md](workfiles/devpost/SUBMISSION.md).

## Demo video

[Watch the EventForge demo on YouTube](https://youtu.be/pht3rrl--pE) for the end-to-end operations-console, GitHub-event, Codex-review, and approval workflow.

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm test
pnpm dev
pnpm dev:console
```

Open `http://localhost:5173`, then select **Run GitHub CI demo**. The control plane is at `http://localhost:4310`.

For the shortest walkthrough, run the demo event, inspect the resulting agent run and approval proposal, then compare the flow with the [demo video](https://youtu.be/pht3rrl--pE).

`docker compose up -d` starts PostgreSQL/pgvector, MinIO, and the control plane once its image is built. Provider OAuth credentials are never included in this repository; demo events exercise the same normalized event flow without them.

## Test a real GitHub webhook through Cloudflare locally

GitHub cannot deliver a webhook directly to `localhost`, so EventForge starts a local Cloudflare Quick Tunnel. Starting GitHub mode creates a random local webhook secret in the ignored `.env`, creates (or reuses) exactly one webhook subscribed to `check_run` and `issues` through the authenticated `gh` CLI, and patches that webhook to the newly created `trycloudflare.com` URL on every launch. The tunnel forwards signed deliveries to the control plane, which acknowledges them before running Codex work in the background.

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

## Review a new GitHub issue in Codex

Local GitHub mode also subscribes to `issues` events. Opening an issue creates a fresh, persisted Codex SDK thread in read-only mode, scoped to this repository. Its thread ID and review summary appear in the EventForge **Agent run log**; issue reviews never create a GitHub comment, branch, or pull request automatically.

```bash
gh issue create --repo OWNER/REPOSITORY \
  --title "Review this engineering issue" \
  --body "Describe the problem, expected behavior, and relevant context."
```

`pnpm dev:github` runs the Codex-backed runner. Keep the process running until the issue appears in the dashboard as a completed run; the issue text is treated as untrusted input and the Codex thread is configured read-only. GitHub receives `202 Accepted` immediately, while the review continues in the persisted Codex thread.

## Packages

- `apps/control-plane` — webhook relay, workflow/policy engine, agent-run orchestration, audit API.
- `apps/console` — React operations console; the Electron shell embeds this surface.
- `apps/desktop` — local Electron companion and private SQLite/LanceDB memory daemon.
- `packages/core` — contracts, signature verification, policy evaluation, memory, and guarded forge logic.
- `packages/mcp-server` — Codex MCP server that controls the local/cloud EventForge API.
- `plugins/eventforge` — native Codex plugin manifest, MCP registration, skill, and opt-in hook.

## Safety model

Incoming provider data is untrusted. EventForge verifies signatures, deduplicates deliveries, redacts secrets, and treats generated connectors as untrusted until validation and explicit approval. All workflow writes default to `approval_required`; workflow owners can grant narrow policies later.
