# Implementation status

Updated: 2026-07-20

## Supported now

| Area                                 | Status                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local demo control plane and console | Supported; deterministic GitHub, Linear, and Sentry fixtures                                                                                                              |
| Provider verification                | GitHub, Linear, and Sentry adapters with signatures, delivery IDs, replay checks where available, redaction, and injected mapping hooks                                   |
| Policy and approvals                 | Resource-aware evaluator foundation; versioned approval/rejection/expiry; default approval required; execution worker not implemented                                     |
| Codex runner                         | Read-only investigation, structured result, process-lifetime thread ID retention, and `resumeThread` support                                                              |
| MCP package                          | Self-starting compiled stdio and loopback Streamable HTTP server; GitHub package install, npm pack, and discovery smoke tests                                             |
| Local relay                          | On-demand MCP startup; Quick/manual named fallbacks; managed per-user tunnel client and hosted provisioner foundation                                                     |
| Codex plugin                         | Manifest, skills, MCP registration, and health-only opt-in lifecycle hook                                                                                                 |
| Electron                             | Compiled main/preload, constrained IPC, separate private user-data SQLite daemon, navigation controls, and package configuration                                          |
| Quality                              | Format, lint, typecheck, tests with coverage, builds, package smoke, deployment validation, recognized global rate limiting, dependency audit, secret scan, and CodeQL CI |

## Commercial platform roadmap implementation

Phase 0 implementation has started with additive, tenant-scoped contracts for endpoints, routes, deliveries and attempts, issues, alert policies, incidents, bounded reaction policies and runs, evidence bundles, usage records, and entitlements. Migration `003_commercial_platform.sql` adds durable resource, entitlement, and idempotent usage-meter storage without enabling remote mode.

These are persistence and interface foundations only. Hosted authentication, repository hydration, outbound delivery workers, billing export, monitoring, alert delivery, reactions, and public commercial APIs are not yet enabled or claimed as supported.

The Cloudflare-native hosted path now has isolated preview and production D1 control/event databases, private R2 payload storage, ingestion Queues and DLQs, and applied initial migrations. `api.eventforge.dev` and `hooks.eventforge.dev` are Worker custom domains with Cloudflare-managed DNS/TLS and host-isolated route surfaces. A deployed preview signed canary returned `202` and reconciled to one processed event, one published outbox item, and one audit entry. Production webhook ingress and authenticated `/v1` APIs remain deliberately gated until Better Auth and tenant repositories are implemented. The static Worker intercepts `/console` and returns a non-cacheable `503` instead of exposing the operations shell before authentication exists.

## Local/private-edge foundations

- PostgreSQL schema and primitives remain available only for local/private deployment; they are no longer the hosted production target.
- Runtime authentication injection point, roles, MFA requirement, scopes, loopback enforcement, body/rate limits, and run quotas.
- Repository interfaces for events, workflows, actions, and audit; broader run/job/memory/artifact interfaces remain Track B work.

## Track B — required before remote production use

- Better Auth account lifecycle, mandatory passkey/TOTP MFA, invitations, recovery, revocation, CSRF, and enterprise SSO.
- MCP OAuth 2.1 Authorization Code with PKCE, resource metadata, scoped short-lived tokens, rotating refresh tokens, and audience checks.
- Complete D1 tenant repositories, durable Queue/DLQ delivery state, Workflow orchestration, retention, backup, and usage reconciliation.
- S3-compatible immutable Forge artifacts, disposable sandbox validation, dependency/source scanning, and out-of-process connector installation.
- pgvector embedding/index/query integration. Local vector search is reported as disabled until an acceptance test passes.
- Multi-workspace production operations and hardened owner-managed integration credentials.
- Production D1, R2, Queue, Workflow, secret, WAF, custom-domain, synthetic-probe, staged-release, and rollback acceptance.

Remote mode remains unavailable through the standard control-plane entry point
while these items are incomplete. The local MCP package/plugin and a separately
authenticated remote Streamable HTTP host are distinct surfaces; configuring a
public URL does not enable unauthenticated remote mode. See
[CONFIGURATION.md](CONFIGURATION.md) for the exact setup and verification
paths. This is a security boundary, not a hidden configuration switch.
