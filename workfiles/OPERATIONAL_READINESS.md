# Operational readiness runbook foundations

No live monitor, alert route, canary, drill, approval, or launch result is represented here. The module and migration define prerequisites only. Documentation never opens a hosted surface. Runtime wiring must use the PostgreSQL readiness repository and a trusted server-side operator authorization resolver; an opaque session reference, issue text, or caller-constructed role object is never authorization.

## Console API

Owner: console-operations. Run the authenticated synthetic tenant journey every five minutes. Alert customer impact within ten minutes; alert authentication/cross-tenant failure immediately. Keep closed without fresh passing evidence and identity Definition of Done.

## Signed ingress

Owner: ingress-operations. Submit a valid signed synthetic event every five minutes; reject unsigned requests. On disable, deny new credentials/work and hold accepted work—never route unauthenticated fallback.

## Investigations

Owner: delivery-operations. Run a GitHub CI/check synthetic every five minutes. Target 99% terminal in ten minutes and median accepted-to-evidence under two minutes. Poison work is alerted within five minutes of retry exhaustion and remains in a safe held/DLQ state.

## Evidence, remote MCP, GitHub App

Use authorized synthetic access/session/installation probes every five minutes. Do not put tenant IDs, payloads, stack traces, or exploit detail in public status, alerts, incident messages, or support bundles. Internal access is role-gated and audited.

## Persistence, recovery, and rollout

Launch evidence and kill-switch transitions are append-only PostgreSQL records. A process restart must reconstruct decisions from those records. Database unavailability is a closed gate, not permission to fall back to process memory. Authorization audit records retain the server-resolved authorization ID, MFA verification time, actor, reason, and whether a security-owner-approved surface was involved.

Rollback is code/config only to a compatible known-good release; never rewind databases or delete evidence/audit ancestry. Repeated rollback without a root-cause record escalates to security/product owners. Restore is separate: encrypted tenant-aware backup, RPO 15 minutes, RTO 4 hours, isolated restoration, integrity and tenant-boundary verification, then controlled promotion.

Stages are internal, a named staff canary with at least one participant, seven measured healthy consecutive days before design partners, at least three design partners over fourteen measured healthy consecutive days, then GA review. Require two organizations and one meaningfully large repository estate; if that estate is unavailable, remain in design partners and record the limitation. Every promotion requires durable evidence IDs from the stage being assessed. A critical breach always resets the clock and returns to internal. Operators cannot suppress append-only probe evidence.

Reconciliation over a supplied snapshot is diagnostic only and reports `productionProof: false`. GA requires an authenticated reconciliation evidence ID from a real adapter with zero variance; a raw number or local fixture cannot satisfy the gate. Recovery plans likewise list required evidence and remain unverified until an isolated restore drill records backup, integrity, and tenant-boundary checks.
