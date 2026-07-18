# EventForge Threat Model

## Assets

EventForge protects provider credentials, webhook secrets, Codex credentials and sessions, repository content, workflow policies, approval identity, project memory, audit evidence, and generated connector artifacts.

## Trust boundaries

1. Provider webhook traffic is public and untrusted until provider-specific verification succeeds.
2. Event payloads remain untrusted after signature verification because an authorized provider user can still submit prompt-injection content.
3. Local mode trusts the operating-system user and binds only to stdio or loopback.
4. Remote console and MCP will require an authenticated workspace principal, MFA, role, and least-privilege scopes; remote mode is disabled until this exists.
5. Codex analysis is currently read-only. A separate, policy-derived write worker is a required Track B boundary.
6. Generated connector source remains untrusted and review-only. Isolated validation and exact-digest approval are required before Track B installation can exist.

## Primary threats and target controls

This table defines the complete production boundary. Items that are not yet enabled are listed in `workfiles/STATUS.md`; the supported local release must not be treated as evidence that every target control is live.

| Threat                        | Required controls                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Forged or replayed webhook    | Raw-body HMAC, provider timestamp window, durable delivery dedupe                           |
| Cross-workspace access        | Server-derived workspace context, role checks, scoped repository queries                    |
| Prompt injection              | Untrusted-data delimiter, structured output, read-only sandbox, no inherited secrets        |
| Policy bypass                 | Central policy decision at proposal, approval, and execution                                |
| Approval spoofing/race        | Server-derived identity, optimistic version, expiry, durable idempotency, append-only audit |
| Unbounded agent cost          | Authenticated route, queue backpressure, per-workspace concurrency and cost quota           |
| Connector supply-chain attack | Dependency allowlist, disabled install scripts, sandboxed validation, artifact digest       |
| Local daemon abuse            | Loopback/stdio only, private user-data directory, no remote binding in local mode           |
| Secret disclosure             | Envelope encryption, response filtering, structured-log redaction, secret scanning          |

## Out of scope for the local demo

The local demo does not claim hostile-local-process isolation, multi-tenant cloud isolation, enterprise SSO, production disaster recovery, or autonomous write execution. Those capabilities must not be advertised as enabled until their acceptance tests pass.
