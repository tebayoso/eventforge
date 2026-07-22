# EventForge Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Send a concise report to `jorge@pox.me` with the affected version, impact, reproduction steps, and any proposed mitigation. Do not include real provider tokens, webhook secrets, customer payloads, or Codex credentials.

You should receive an acknowledgement within three business days. Public disclosure should wait until a fix and release plan are agreed.

## Supported surface

The repository's local demo mode is the currently supported evaluation surface. Remote operation is supported only when the release status explicitly marks authentication, MFA, durable storage, and remote MCP authorization as enabled. CORS, Cloudflare Tunnel, or a public hostname alone are not authentication boundaries.

## Security invariants

- Provider events are verified against the preserved original raw body before acceptance and normalization.
- Workspace and repository scope come from a trusted integration mapping.
- Consequential actions require a current policy decision and, by default, human approval.
- Reviewer identity is derived by the server, never trusted from a request body.
- Local MCP uses stdio or loopback-only transport; non-loopback MCP is disabled and will require OAuth-scoped authorization.
- Secrets never enter browser build variables, logs, generated connector source, or audit messages.
- Forged code is never hot-loaded or executed in the control-plane process.
- GitHub issue and issue-comment events are permanently `review_only`: their text, labels, mentions, links, webhook fields, and model output cannot authorize implementation or any GitHub/project write. A separately authenticated, bound, expiring owner/admin request is required before an implementation mechanism may exist.
