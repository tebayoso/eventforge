# Policy pack dependency map (#5)

| Dependency         | State   | Hosted boundary                                                                    |
| ------------------ | ------- | ---------------------------------------------------------------------------------- |
| Policy schema      | Partial | Core manifest and migration exist; no hosted CRUD.                                 |
| Evaluator          | Exists  | One core evaluator serves live and simulation adapters.                            |
| #7 identity        | Missing | Owner/recent-MFA checks cannot be enabled.                                         |
| #17 evidence/audit | Partial | Local audit exists; retained authorized snapshot store is missing.                 |
| Tenant store       | Partial | Composite PostgreSQL schema exists; hosted repository hydration is missing.        |
| Signing keys       | Missing | Verification primitive exists; workspace trust store/external secrets are missing. |
| Job runner         | Partial | Durable primitives exist; simulation runner/concurrency/timeout is missing.        |

Therefore import, activation, rollback, and hosted simulation are fail-closed. Rollback must create a new activation for future decisions only; it must never undo prior approvals, incidents, reactions, entitlements, or external effects.
