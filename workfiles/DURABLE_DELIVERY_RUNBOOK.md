# Durable tenant delivery runbook

Hosted ingress remains fail-closed until `PUBLIC_INGRESS_ENABLED`, `DURABLE_DELIVERY_ENABLED`, and `MONITORING_ENABLED` are all enabled, the queue bindings exist, and verified `delivery_installations` mappings are populated. This change does not claim a live drill.

Each accepted delivery writes a workspace-scoped logical delivery and outbox intent before returning `202`. Cloudflare Queue is at-least-once; outcome and usage rows use the workspace-scoped logical-delivery key. There is no exactly-once transport or global ordering claim.

Operators may inspect only metadata: state, safe reason, attempt count, retry time, correlation ID, and timestamps. Payload retrieval is a separate authorized operation. DLQ viewing/export never queues work. Authorized retry must revalidate an active mapping and creates a non-billable attempt; deletion waits for the immutable DLQ record's 30-day retention boundary and records an audit event.

Reconciliation is deliberately bounded: expired accepted/queued work without an attempt receives one non-billable reconciliation failure then requeues when budget remains; expired processing leases fail and requeue or quarantine by budget; a terminal delivery without an outcome quarantines with `reconciliation`. It is idempotent and audited, not a repair engine.

Suspended mappings quarantine and notify workspace owners/admins through the notification integration before any retry. Deleted mappings quarantine permanently and are scheduled for retention deletion. Never place payloads or upstream error bodies in queue logs, DLQ metadata, or alerts.
