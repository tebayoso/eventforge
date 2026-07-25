# Implementation status

Updated: 2026-07-22

## Timeline foundation (#19)

Core timeline schemas, deterministic canonical manifest hashing, typed redaction omissions, HTML field alignment, and an additive PostgreSQL table are implemented. There is no hosted endpoint, customer export, signing-key wiring, or live evidence claim; those remain closed on #7/#13/#17 dependencies.

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
## Demand-validated source foundations (issue #10)

GitLab Cloud, Jira Cloud, and Datadog have isolated `v1` event matrices and closed readiness records. The records hold only availability, approval reference, matrix version, and gate evidence; partner commitments remain external business evidence. No provider is shipped or enabled: hosted ingress remains fail-closed. GitLab self-managed, Jira Data Center, writes, and Datadog streams/metrics/logs/traces/synthetics are excluded. Mapping requires server-side provider attestation and Owner confirmation, and conflicts block a resource from mapping to a second workspace. Datadog only permits a narrow, redacted monitor transition shape. Further authentication, replay, lifecycle, deletion, health, and durable ingress work remains closed pending individual provider evidence and security design.
Enterprise governance has an additive, forward-only contract and migration foundation for enterprise organization scope, federation/SCIM resources, break-glass, holds, customer key references, ordered audit stream events, and measured-SLO records. It does not enable hosted enterprise capability: identity, key, hold, audit-sink, outage/recovery, and legal/support gates remain closed pending end-to-end evidence.
Outcome analytics now has an additive, versioned core projection and append-only transition migration. It distinguishes exact provider effect verification from independently evidenced resolution, leaves unavailable/ambiguous evidence unknown, carries source cutoff and completeness/freshness, and treats retries as the same business subject. This is fixture arithmetic and persistence foundation only: authenticated dashboards, aggregation privacy controls, exports, membership/correlation ledger integration, and live provider evidence adapters remain unavailable.
### #21 provider-installation security foundation (fixture-only)

Sentry and Linear now have additive installation contracts and a PostgreSQL migration for one-workspace, one-provider-account bindings. Each selection requires explicit confirmed resource ids (selective or explicitly labelled all-discovered), Sentry is schema-enforced read-only, and Linear reaction contracts allow only comment, allowlisted state transition, or enumerated priority update. Remote webhook lookup now requires an exact server-side provider installation key; payload claims never select a workspace. Credentials remain encrypted-at-rest migration fields only and are not wired to hosted execution. Health polling, OAuth discovery, deletion workers, rotation windows, and reaction execution remain gated Track B work; local adapters remain unchanged.
Operational-readiness foundations now model tenant-safe per-surface launch gates, durable append-only PostgreSQL evidence and kill-switch history, a trusted operator-authorization resolver contract, synthetic probe requirements, diagnostic-only snapshot reconciliation, public-status projection, evidence-backed rollback/restore constraints, owned alert routes, and staged rollout evaluation. These are configuration, fixture, and persistence foundations only: no live monitors, canary, restore drill, alert delivery, authorization resolver implementation, or launch approval is claimed; each hosted surface remains closed until independent authenticated evidence is durably recorded.

Phase 0 implementation has started with additive, tenant-scoped contracts for endpoints, routes, deliveries and attempts, issues, alert policies, incidents, bounded reaction policies and runs, evidence bundles, usage records, and entitlements. Migration `003_commercial_platform.sql` adds durable resource, entitlement, and idempotent usage-meter storage without enabling remote mode.

These are persistence and interface foundations only. A local core reaction-worker enforcement kernel now provides strict GitHub/Linear allowlisted action envelopes, deterministic exact-effect hashes, and fail-closed approval/policy/scope/kill-cache/budget/concurrency reservation checks. It has no provider writer or credentials, so shadow/hosted effects cannot execute from this slice. Hosted authentication, repository hydration, durable reservation storage, outbound delivery workers, billing export, monitoring, alert delivery, reconciliation, and public commercial APIs remain unenabled and are not claimed as supported.

Phase 2 correlation now has versioned configuration and immutable event/membership contracts, launch-bounded deterministic rule evaluation, and tenant/project filtering before candidate comparison. The additive `004_incident_correlation.sql` migration persists versioned configs and 90-day membership metadata. This is observe-only foundation only: authenticated incident APIs, canonical-event impact/investigation persistence, alias storage, manual merge/split, redacted timeline/export, backfill, review metrics, and suppression remain unavailable. Hosted mode remains fail-closed.

The Cloudflare-native hosted path now has isolated preview and production D1 control/event databases, private R2 payload storage, ingestion Queues and DLQs, and applied initial migrations. `api.eventforge.dev` and `hooks.eventforge.dev` are Worker custom domains with Cloudflare-managed DNS/TLS and host-isolated route surfaces. A deployed preview signed canary returned `202` and reconciled to one processed event, one published outbox item, and one audit entry. Production webhook ingress and authenticated `/v1` APIs remain deliberately gated until Better Auth and tenant repositories are implemented. The static Worker intercepts `/console` and returns a non-cacheable `503` instead of exposing the operations shell before authentication exists.

## Local/private-edge foundations

Issue #9 adds a versioned Helm security reference and executable fail-closed preflight. It does **not** make private edge available: Cloudflare Worker D1/R2/Queue/cron and hosted identity contracts lack exercised portable adapters. Capacity is unavailable until repeatable load fixtures measure it. Security/install/node-loss/queue/backup-restore/key/upgrade/rollback drills and two design partners remain required release evidence.

- PostgreSQL schema and primitives remain available only for local/private deployment; they are no longer the hosted production target.
- Runtime authentication injection point, roles, MFA requirement, scopes, loopback enforcement, body/rate limits, and run quotas.
- Repository interfaces for events, workflows, actions, and audit; broader run/job/memory/artifact interfaces remain Track B work.

## Track B — required before remote production use

### Issue #11 graduated-autonomy foundation

`packages/core/src/autonomy.ts` now defines the fail-closed, immutable grant and shadow-evidence eligibility contract for the launch-only GitHub informational-label class. It is not a provider execution worker: approval-required remains the default and remote autonomy remains disabled. A future worker must still provide transactional aggregate budgets, signed kill-switch epochs, fresh independent provider verification, and independently verified rollback before it can consume an eligible grant.

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
