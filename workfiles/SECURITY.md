# EventForge Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Send a concise report to `jorge@pox.me` with the affected version, impact, reproduction steps, and any proposed mitigation. Do not include real provider tokens, webhook secrets, customer payloads, or Codex credentials.

You should receive an acknowledgement within three business days. Public disclosure should wait until a fix and release plan are agreed.

## Supported surface

The repository's local demo mode is the currently supported evaluation surface. Remote operation is supported only when the release status explicitly marks authentication, MFA, durable storage, and remote MCP authorization as enabled. CORS, Cloudflare Tunnel, or a public hostname alone are not authentication boundaries.

## Security invariants

- Provider events are verified against the preserved original raw body before acceptance and normalization.
- Workspace and repository scope come from a trusted integration mapping.
- Consequential actions require a current policy decision and, by default, human approval.
- Reviewer identity is derived by the server, never trusted from a request body.
- Local MCP uses stdio or loopback-only transport; non-loopback MCP is disabled and will require OAuth-scoped authorization.
- Secrets never enter browser build variables, logs, generated connector source, or audit messages.
- Forged code is never hot-loaded or executed in the control-plane process.
- Hosted sessions and tokens are opaque identifiers. Every hosted request checks
  the strongly consistent session authority; no offline JWT can outlive a role,
  membership, factor, recovery, or session revocation.
- Owner and Admin access requires an enrolled passkey or TOTP factor. Privileged
  operations require a factor proof no older than 15 minutes; normal activity
  never extends that window.
- WebAuthn registration and authentication are bound to the production origin,
  RP ID, current account, server challenge, and signature counter. User
  verification is required and credential backup state is retained for review.
- Recovery codes are generated with a cryptographically secure random source,
  displayed once, stored only as individually salted slow hashes, and consumed
  atomically. Regeneration invalidates every earlier code.
- Browser mutations use same-origin host-only secure cookies, non-simple JSON
  requests, strict Origin and Fetch Metadata validation, and sensitive-action
  reauthentication. The session bootstrap returns a request token bound to the
  server-side session; every mutation must echo it in a dedicated header.
  Authentication responses do not reveal whether an account or workspace exists.
- Invitations bind one workspace, exact normalized email, intended role,
  inviter, opaque identifier, and seven-day expiry. Imported or forwarded data
  cannot grant membership to a different identity. Existing and new users follow
  the same acceptance response and verification destination; membership is
  created server-side only after verified identity resolution.
- The final workspace owner cannot be removed, downgraded, leave, or close the
  owning account. Ownership transfer requires recent MFA and an existing
  verified successor; support has no impersonation or silent override path.
- Governance audit events are actor- and session-attributed, tenant-scoped, and
  append-only through the application interface. Issue #17 remains responsible
  for tamper evidence, retention, export, and the immutable-evidence lifecycle;
  issue #7 does not claim those stronger guarantees early.
