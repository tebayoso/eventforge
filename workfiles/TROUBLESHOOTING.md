# EventForge Troubleshooting

## Console reports offline or degraded

1. Check `curl http://127.0.0.1:4310/health`.
2. Start the control plane with `pnpm dev` and the console in a second terminal with `pnpm dev:console`.
3. Confirm `VITE_EVENTFORGE_API_URL` points to the intended API and that `EVENTFORGE_ALLOWED_ORIGINS` includes the exact browser origin.
4. A failed resource request must remain visible as degraded; do not interpret an empty panel as proof that no events or approvals exist.

## EventForge MCP tools are missing

1. Run `pnpm --filter @eventforge/mcp-server pack:check`.
2. Run `pnpm plugin:check` to verify the bundled server starts without writing non-protocol data to stdout.
3. Review the plugin's `.mcp.json` and `.codex-plugin/plugin.json` paths.
4. Restart Codex after installing or changing a plugin. Plugin-bundled hooks require a separate trust review when their content changes.

## A live webhook is rejected

- Verify the provider uses the matching signing secret and sends the original raw JSON body.
- GitHub signatures include the `sha256=` prefix; Linear and Sentry signatures are bare hexadecimal digests.
- Linear and Sentry timestamps outside their configured replay window are rejected.
- In remote foundation tests, confirm the injected provider delivery/installation mapping selects the expected workspace, project, and repository. Local GitHub mode uses its configured repository.

## GitHub local tunnel does not start

- Install `cloudflared` and authenticate the `gh` CLI for the target repository.
- Set `EVENTFORGE_GITHUB_REPOSITORY=OWNER/REPOSITORY` when automatic detection is ambiguous.
- Quick Tunnels are temporary and receive a new URL on each launch; EventForge patches its single managed repository webhook.
- Do not reuse Quick Tunnels for production traffic.

## Docker Compose configuration fails

Run `docker compose config --quiet` before starting services. The default stack does not require a Cloudflare token. `CLOUDFLARE_TUNNEL_TOKEN` is required only when enabling `--profile cloudflare-tunnel`.

## Remote mode refuses to start

This is intentional when the production safety boundary is incomplete. Remote mode requires PostgreSQL, an encryption key, explicit browser origins, and a configured authenticator. Do not bypass startup validation or substitute CORS for authentication.

## Electron packaging fails

Run the console build before the desktop package command. Confirm the desktop build contains compiled `dist/main.js` and `dist/preload.js`, and that the packaged resources contain the console `index.html`. Signing/notarization credentials are external release secrets and are not stored in the repository.
