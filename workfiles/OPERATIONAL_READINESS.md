# Operational readiness runbook foundations

No live monitor, alert route, canary, drill, approval, or launch result is represented here. The module and migration define prerequisites only.

## Console API

Owner: console-operations. Run the authenticated synthetic tenant journey every five minutes. Alert customer impact within ten minutes; alert authentication/cross-tenant failure immediately. Keep closed without fresh passing evidence and identity Definition of Done.

## Signed ingress

Owner: ingress-operations. Submit a valid signed synthetic event every five minutes; reject unsigned requests. On disable, deny new credentials/work and hold accepted work—never route unauthenticated fallback.

## Investigations

Owner: delivery-operations. Run a GitHub CI/check synthetic every five minutes. Target 99% terminal in ten minutes and median accepted-to-evidence under two minutes. Poison work is alerted within five minutes of retry exhaustion and remains in a safe held/DLQ state.

## Evidence, remote MCP, GitHub App

Use authorized synthetic access/session/installation probes every five minutes. Do not put tenant IDs, payloads, stack traces, or exploit detail in public status, alerts, incident messages, or support bundles. Internal access is role-gated and audited.

## Recovery and rollout

Rollback is code/config only to a compatible known-good release; never rewind databases or delete evidence/audit ancestry. Repeated rollback without a root-cause record escalates to security/product owners. Restore is separate: encrypted tenant-aware backup, RPO 15 minutes, RTO 4 hours, isolated restoration, integrity and tenant-boundary verification, then controlled promotion.

Stages are internal, staff canary (seven healthy consecutive days), at least three design partners (fourteen healthy consecutive days), then GA review. Require two organizations and one meaningfully large repository estate when available; record any limitation. Critical breach resets the clock and demotes to the safe prior stage. Operators cannot suppress append-only probe evidence.
