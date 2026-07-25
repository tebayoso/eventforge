# Implementation status

Updated: 2026-07-20

## Issue #17 replay/audit foundation

Core now contains an adapter-backed EvidenceStore/AuditLedger split: expired content is replaced
with a blanked record and becomes unavailable while tenant-scoped proof retains only hashes,
attribution, redaction/policy/decision references, ancestry hash, and outcome. Replay uses a trusted
clock and authoritative attempt/policy lookups, requires recent MFA/authorization, evidence
availability, reason and request-consistent idempotency, and creates a fresh pending-approval linked
attempt. Async repository transactions atomically couple replay/approval compare-and-set state with
their audit entries and require commit-time revalidation of authorization, parent status, MFA and
evidence deadlines, current policy, and the full evidence provenance fingerprint.
Retention is bounded from a trusted storage clock; corrupt expiry data becomes unavailable and
eligible for deletion. Policy or evidence changes block stale approval. Export helpers produce
matching canonical JSON and escaped HTML covered by keyed integrity verification.

The bundled in-memory adapters are explicitly ephemeral test/demo implementations. Replay fails
closed unless authorization, audit, and durable repositories are operational; tests must opt into
the ephemeral escape explicitly. Hosted key custody, adapter transactions, audited evidence access,
deletion/export workflows, and privacy/security drills remain required before this can be exposed as
a hosted API.

## Supported now

| Area                                 | Status                                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local demo control plane and console | Supported; deterministic GitHub, Linear, and Sentry fixtures                                                                                                               |
| Provider verification                | GitHub, Linear, and Sentry adapters with signatures, delivery IDs, replay checks where available, redaction, and injected mapping hooks                                    |
| Policy and approvals                 | Resource-aware evaluator foundation; versioned approval/rejection/expiry; default approval required; execution worker not implemented                                      |
| Codex runner                         | Read-only investigation, structured result, process-lifetime thread ID retention, and `resumeThread` support                                                               |
| GitHub issue review                  | Review-only deterministic assessment; issue events cannot invoke the agent or create a write proposal. Manual authenticated implementation is not activated by issue text. |
| MCP package                          | Self-starting compiled stdio and loopback Streamable HTTP server; GitHub package install, npm pack, and discovery smoke tests                                              |
| Local relay                          | On-demand MCP startup; Quick/manual named fallbacks; managed per-user tunnel client and hosted provisioner foundation                                                      |
| Codex plugin                         | Manifest, skills, MCP registration, and health-only opt-in lifecycle hook                                                                                                  |
| Electron                             | Compiled main/preload, constrained IPC, separate private user-data SQLite daemon, navigation controls, and package configuration                                           |
| Quality                              | Format, lint, typecheck, tests with coverage, builds, package smoke, deployment validation, recognized global rate limiting, dependency audit, secret scan, and CodeQL CI  |

## Commercial platform roadmap implementation

## Policy packs (#5)

Phase A foundation: a single deterministic evaluator now emits policy/context digests, evaluator/schema provenance, outcome, scope, matched rules and reason codes. Pack manifests are immutable/content-addressed and `004_policy_packs.sql` provides tenant-composite version, serialized activation, and simulation records. Phase B foundation: simulation invokes that same evaluator only and accepts evidence inputs as data; it has no action, approval, incident, billing, reaction, notification, or mutation adapter. Missing retained evidence and authorization produce blocked/partial coverage rather than a complete claim.

Hosted pack import, signing-key trust administration, owner/recent-MFA activation, job execution, evidence retention, and identity are not wired, so hosted policy-pack operations remain closed. Local fixtures validate evaluator equivalence and fail-closed simulation/import cases; no production policy pack, signing key, or historical evidence was exercised.

Phase 0 implementation has started with additive, tenant-scoped contracts for endpoints, routes, deliveries and attempts, issues, alert policies, incidents, bounded reaction policies and runs, evidence bundles, usage records, and entitlements. Migration `003_commercial_platform.sql` adds durable resource, entitlement, and idempotent usage-meter storage without enabling remote mode.

These are persistence and interface foundations only. Hosted authentication, repository hydration, outbound delivery workers, billing export, monitoring, alert delivery, reactions, and public commercial APIs are not yet enabled or claimed as supported.

Phase 2 correlation now has versioned configuration and immutable event/membership contracts, launch-bounded deterministic rule evaluation, and tenant/project filtering before candidate comparison. The additive `004_incident_correlation.sql` migration persists versioned configs and 90-day membership metadata. This is observe-only foundation only: authenticated incident APIs, canonical-event impact/investigation persistence, alias storage, manual merge/split, redacted timeline/export, backfill, review metrics, and suppression remain unavailable. Hosted mode remains fail-closed.

The Cloudflare-native hosted path now has isolated preview and production D1 control/event databases, private R2 payload storage, ingestion Queues and DLQs, and applied initial migrations. `api.eventforge.dev` and `hooks.eventforge.dev` are Worker custom domains with Cloudflare-managed DNS/TLS and host-isolated route surfaces. A deployed preview signed canary returned `202` and reconciled to one processed event, one published outbox item, and one audit entry. Production webhook ingress and authenticated `/v1` APIs remain deliberately gated until Better Auth and tenant repositories are implemented. The static Worker intercepts `/console` and returns a non-cacheable `503` instead of exposing the operations shell before authentication exists.

## Local/private-edge foundations

Issue #9 adds a versioned Helm security reference and executable fail-closed preflight. It does **not** make private edge available: Cloudflare Worker D1/R2/Queue/cron and hosted identity contracts lack exercised portable adapters. Capacity is unavailable until repeatable load fixtures measure it. Security/install/node-loss/queue/backup-restore/key/upgrade/rollback drills and two design partners remain required release evidence.

- PostgreSQL schema and primitives remain available only for local/private deployment; they are no longer the hosted production target.
- Runtime authentication injection point, roles, MFA requirement, scopes, loopback enforcement, body/rate limits, and run quotas.
- Repository interfaces for events, workflows, actions, and audit; broader run/job/memory/artifact interfaces remain Track B work.

## Track B — required before remote production use

- Better Auth account lifecycle, mandatory passkey/TOTP MFA, invitations, recovery, revocation, CSRF, and enterprise SSO.
- MCP OAuth 2.1 Authorization Code + S256 PKCE domain foundations: static first-party
  clients, protected-resource metadata, opaque 15-minute access tokens, seven-day
  rotating refresh families, audience/workspace/scope checks, and per-request identity
  authority port. This remains non-production until durable grants, live authority,
  security testing, configuration, and the external penetration-test gate are complete.
- Complete D1 tenant repositories, durable Queue/DLQ delivery state, Workflow orchestration, retention, backup, and usage reconciliation.
- S3-compatible immutable Forge artifacts, disposable sandbox validation, dependency/source scanning, and out-of-process connector installation.

## Connector trust layer (issue #8)

The core package now contains an in-memory, fail-closed trust-manifest and approval foundation: canonical JCS manifests, SHA-256 subjects, DSSE-style Ed25519 envelopes, signer revocation/expiry checks, exact-digest Owner-plus-recent-MFA approval binding, critical-finding blocks, and a deterministic denial sandbox fixture. It does not provide production artifact storage, managed signing keys, a credential vault, durable audit, scanner/SBOM tools, or a sandbox provider. Consequently validation and installation stay closed; no production connector install path is enabled.

- pgvector embedding/index/query integration. Local vector search is reported as disabled until an acceptance test passes.
- Multi-workspace production operations and hardened owner-managed integration credentials.
- Production D1, R2, Queue, Workflow, secret, WAF, custom-domain, synthetic-probe, staged-release, and rollback acceptance.

Remote mode remains unavailable through the standard control-plane entry point
while these items are incomplete. The local MCP package/plugin and a separately
authenticated remote Streamable HTTP host are distinct surfaces; configuring a
public URL does not enable unauthenticated remote mode. See
[CONFIGURATION.md](CONFIGURATION.md) for the exact setup and verification
paths. This is a security boundary, not a hidden configuration switch.
