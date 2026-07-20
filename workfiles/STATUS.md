# Implementation status

Updated: 2026-07-20

## Supported now

| Area                                 | Status                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local demo control plane and console | Supported; deterministic GitHub, Linear, and Sentry fixtures                                                                                                              |
| Provider verification                | GitHub, Linear, and Sentry adapters with signatures, delivery IDs, replay checks where available, redaction, and injected mapping hooks                                   |
| Policy and approvals                 | Resource-aware evaluator foundation; versioned approval/rejection/expiry; default approval required; execution worker not implemented                                     |
| Codex runner                         | Read-only investigation, structured result, process-lifetime thread ID retention, and `resumeThread` support                                                              |
| MCP package                          | Compiled stdio and Streamable HTTP server; npm pack and discovery smoke tests                                                                                             |
| Local relay                          | On-demand MCP startup; Quick/manual named fallbacks; managed per-user tunnel client and hosted provisioner foundation                                                     |
| Codex plugin                         | Manifest, skills, MCP registration, and health-only opt-in lifecycle hook                                                                                                 |
| Electron                             | Compiled main/preload, constrained IPC, separate private user-data SQLite daemon, navigation controls, and package configuration                                          |
| Quality                              | Format, lint, typecheck, tests with coverage, builds, package smoke, deployment validation, recognized global rate limiting, dependency audit, secret scan, and CodeQL CI |

## Commercial platform roadmap implementation

Phase 0 implementation has started with additive, tenant-scoped contracts for endpoints, routes, deliveries and attempts, issues, alert policies, incidents, bounded reaction policies and runs, evidence bundles, usage records, and entitlements. Migration `003_commercial_platform.sql` adds durable resource, entitlement, and idempotent usage-meter storage without enabling remote mode.

These are persistence and interface foundations only. Hosted authentication, repository hydration, outbound delivery workers, billing export, monitoring, alert delivery, reactions, and public commercial APIs are not yet enabled or claimed as supported.

## Foundations present but not enabled remotely

- PostgreSQL schema and primitives for transactional event/audit/job ingestion and leased `FOR UPDATE SKIP LOCKED` work.
- Runtime authentication injection point, roles, MFA requirement, scopes, loopback enforcement, body/rate limits, and run quotas.
- Repository interfaces for events, workflows, actions, and audit; broader run/job/memory/artifact interfaces remain Track B work.

## Track B — required before remote production use

- Better Auth account lifecycle, mandatory passkey/TOTP MFA, invitations, recovery, revocation, CSRF, and enterprise SSO.
- MCP OAuth 2.1 Authorization Code with PKCE, resource metadata, scoped short-lived tokens, rotating refresh tokens, and audience checks.
- Complete PostgreSQL repository wiring, restart hydration, durable idempotency, cancellation, and worker lifecycle.
- S3-compatible immutable Forge artifacts, disposable sandbox validation, dependency/source scanning, and out-of-process connector installation.
- pgvector embedding/index/query integration. Local vector search is reported as disabled until an acceptance test passes.
- Multi-workspace production operations and hardened owner-managed integration credentials.
- Deployment of the authenticated managed-tunnel provisioner with valid Cloudflare account/zone credentials; the public site does not expose tunnel minting yet.

Remote mode remains unavailable through the standard entry point while these items are incomplete. This is a security boundary, not a hidden configuration switch.
