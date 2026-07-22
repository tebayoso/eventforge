# Architecture

## Runtime boundaries

```mermaid
flowchart LR
  providers["GitHub / Linear / Sentry"] -->|"signed raw delivery"| relay["Fastify control plane"]
  console["Browser console"] -->|"authenticated in remote mode"| relay
  electron["Electron + preload IPC"] -->|"loopback only"| relay
  codex["Codex plugin / MCP stdio"] -->|"loopback only"| relay
  provisioner["Authenticated hosted provisioner"] -->|"tunnel-scoped token"| relay
  provisioner -->|"account API: tunnel + DNS"| cloudflare["Cloudflare Tunnel"]
  cloudflare -->|"three-word.eventforge.dev"| relay
  relay --> policy["Workflow + policy decision"]
  policy --> runner["Read-only Codex runner"]
  policy --> approvals["Versioned approval proposals"]
  electron -. "daemon foundation; console not yet wired" .-> sqlite["Private SQLite local memory"]
  relay -. "Track B wiring" .-> postgres["PostgreSQL jobs and audit"]
  relay -. "Track B wiring" .-> objectStorage["S3 artifacts + isolated Forge"]
```

Local mode is the supported runnable mode. The API binds to loopback, local MCP
uses stdio without credentials, and the standalone package/plugin can embed that
API automatically. The loopback HTTP MCP launcher is available for clients that
cannot use stdio. Electron exposes a narrow preload bridge, and consequential
proposals require a separate decision. See [CONFIGURATION.md](CONFIGURATION.md)
for the supported launch modes and environment contract.

Remote mode is intentionally fail-closed. Startup requires PostgreSQL, an encryption key, explicit browser origins, and an injected MFA-authenticated identity provider. The repository contains durable PostgreSQL schema and queue primitives, but the normal entry point does not enable remote mode until authentication and complete repository hydration are wired.

## Trust boundaries

- Provider bodies are untrusted until provider-specific raw-body signature, delivery identifier, and replay checks where supported succeed. Remote installation scope is resolved separately through configured mappings.
- Workspace and project scope comes from configured integration mappings in remote mode, never webhook-supplied workspace fields.
- Policy is evaluated at proposal creation and again at approval. The evaluator constrains role, provider, repository, path, domain, capability, approval mode, and policy version; current generated proposals do not yet derive exact changed paths.
- Codex analysis is read-only. Approval changes proposal state; it does not execute or hot-load code.
- Forge Studio currently creates and statically scans a reviewable draft. Disposable sandboxes, immutable artifact storage, and out-of-process connector execution are Track B work.
- Managed tunnel names are deterministic pseudorandom three-word slugs derived from the authenticated actor/workspace and a server-only HMAC key. The hosted provisioner owns Cloudflare account credentials; local EventForge receives only the tunnel-scoped run token and launches `cloudflared` with a protected token file. Cloudflare ingress and the loopback router expose only `/health` and exact signed-provider webhook paths through the public hostname. The public provisioning route remains disabled until remote owner authentication and Cloudflare account/zone secrets are configured.

## Stable contracts

The runtime contracts live in `packages/core/src/contracts.ts`: `RuntimeMode`, `AuthContext`, `ProviderAdapter`, `PolicyDecision`, `EventEnvelope`, `WorkflowDefinition`, `ActionProposal`, `ForgeJob`, repository interfaces, and MCP scopes.

## Timeline foundation (#19)

`packages/core/src/timeline.ts` defines tenant-scoped, append-only timeline entry and export contracts. It separates facts, findings, proposals, policy results, decisions, attempts, and outcomes; corrections are new entries linked through causal/version references. The canonical manifest is deterministic JSON with SHA-256 integrity hashing, an explicit machine-to-human field map, and a standalone verifier. Redacted, expired, and deleted entries remain typed omissions. This is an internal deterministic foundation only: hosted viewing/export stays fail-closed until #7, #13, and #17 provide authenticated repositories, revocation, and recent-MFA signing-key access.
