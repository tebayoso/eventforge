# Review: PR #34 — gated demand source contracts (issue #10)

Reviewed `git diff origin/1.0-rc...HEAD` at branch commit `4436b70`, integrated into
`origin/1.0-rc` (`5e0a56b`) as merge `eb34a78`.

## Scope of the branch

97 added lines across four files: `packages/core/src/demand-sources.ts` (new),
its test, one barrel export, one STATUS.md section. No migrations, no routes,
no ingress wiring.

Verified by grep across `*.ts/tsx/mjs/cjs`: **nothing in the repo consumes any
export of `demand-sources.ts`.** The only references are the barrel re-export and
the test. STATUS.md's claim that no provider is enabled and hosted ingress
remains fail-closed is accurate — this is contract surface only. Every finding
below is therefore latent, not currently exploitable, but each one is a defect
that future ingress work would inherit.

## Merge conflicts resolved

| File                         | Resolution                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts` | Additive. Kept both `./demand-sources.js` (HEAD) and `./durable-delivery.js` (1.0-rc). No existing export dropped.          |
| `workfiles/STATUS.md`        | Auto-merged additively by git; verified both the issue #10 section and 1.0-rc's issue #17 replay/audit section are present. |

`workfiles/CONFIGURATION.md` and `ARCHITECTURE.md` did not conflict — this branch
does not touch them.

## Fixes applied during integration

1. **`format:check` failed** on both new files (they were committed unformatted;
   the quality gate's first step rejected them). Ran prettier. Verified
   token-for-token that the reformat is pure line-wrapping — no operator,
   condition, or identifier changed.
2. **Test file was in `src/`, emitted into published `dist/`.** `packages/core/tsconfig.json`
   has `include: ["src"]`, so `src/demand-sources.test.ts` compiled to
   `dist/demand-sources.test.js` + `.d.ts` + maps, and `dist` is the package's
   only `files` entry. Every other core test lives in `packages/core/test/`
   precisely to avoid this. Moved to `test/demand-sources.test.ts` and fixed the
   import to `../src/demand-sources.js`, matching `durable-delivery.test.ts`.

No test was weakened, skipped, or deleted; no coverage threshold was changed.

## Findings

### 1. MEDIUM — Datadog `status` is not allowlisted, contradicting its own test — FIXED in `8442699`

`normalizeDatadogMonitorTransition` (`demand-sources.ts:87-107`) type-checks
`transition.status` as a string and passes it straight into the returned durable
evidence record. There is no allowlist of statuses.

The test that covers it is titled _"admits only allowlisted discrete Datadog
monitor transitions"_ — a property the implementation does not have. No assertion
in that test would fail if statuses were fully unbounded. The module allowlists
event _types_ (`supportedEventMatrix`) and filters _tags_ by regex, so the
omission reads as an oversight rather than a decision.

Failure scenario: a webhook body with
`{type:"monitor_alert_transition", monitor:{id:"1"}, transition:{status:<arbitrary attacker string>, at:"..."}}`
places unbounded attacker-controlled content into a record the module's doc
comment describes as deliberately narrow and redacted. Not reachable today (no
caller), but this function is the designated sanitizer for that provider, so
whatever wires Datadog ingress will trust it.

**Resolution (`8442699`):** a module-private
`datadogMonitorTransitionStatuses` allowlist now admits only the discrete monitor
states `OK`, `Alert`, `Warn`, `No Data`; anything else returns `undefined`,
matching how the function already rejects malformed payloads rather than
throwing. The public API is unchanged. The test now asserts each allowlisted
status round-trips and that non-allowlisted values — including case and substring
near-misses (`alert`, `ALERT`, `Alert `, `Alerting`, `No  Data`), the empty
string, a script payload, and a 4096-character string — are rejected. Verified by
mutation: with the allowlist line removed the test fails, admitting
`status: "Triggered"` into the evidence record.

### 2. LOW — `establishProviderMapping` conflict check can miss a cross-workspace conflict

`demand-sources.ts:65-72` uses `.find` to locate the first mapping matching
`(provider, providerAccountId, resourceId)`, then throws only if _that one_
belongs to a different workspace.

Failure scenario: if `mappings` already contains the same triple twice — the
caller's own workspace first, another workspace second — `.find` returns the
caller's own, the inequality check passes, and the mapping is admitted despite the
resource being mapped elsewhere. Requires already-inconsistent state to trigger
(this function is what prevents that state), so it is a defense-in-depth gap, not
a live hole. A strictly fail-closed form is
`.some(c => tripleMatches(c) && c.workspaceId !== mapping.workspaceId)`.

### 3. LOW — `acceptsProviderEvent` throws instead of returning false for an unknown provider

`demand-sources.ts:76-84`: `supportedEventMatrix[provider]` is `undefined` for any
provider string outside the union, so `.includes` raises a `TypeError`. The
compile-time union prevents this within the repo, but this function is exported
through the public barrel and its intended callers sit at a webhook ingress
boundary where the provider name arrives as untrusted input and the union is not
a runtime guarantee. It rejects rather than admits, so it is not fail-open — but
an unhandled crash is a worse rejection than a clean `false`.

### 4. LOW — `providerReadinessManifest` is mutable at runtime

`demand-sources.ts:18-25` is typed `readonly ProviderReadiness[]`, which is
erased at runtime: both the array and each record object are mutable.
`providerGateOpen` defaults to this shared module-level manifest, so any code in
the same realm can set `status`/`gateEvidence`/`approvalReference` on the shared
objects and open every provider gate process-wide.

This is inconsistent with the codebase's own convention for tamper-resistant
security records: the sibling module `replay-audit.ts` — merged from 1.0-rc, the
closest comparable boundary — calls `Object.freeze` on its records in nine
places. `supportedEventMatrix` got `as const satisfies`; the manifest got no
equivalent runtime protection. Freezing the array and each record would make the
fail-closed default tamper-evident.

### 5. LOW — the fail-closed gate's discriminating cases are untested — MOSTLY FIXED in `8442699`

`demand-sources.ts` reports 92.95% lines / **75% branches**. It passes only
because `packages/core/vitest.config.ts` thresholds (90 lines / 85 branches) are
package-wide and other files carry it. The uncovered branches are the ones that
matter for this module's stated purpose:

- **Lines 41-42** — `providerGateOpen` is only ever exercised against the
  all-closed default manifest. The gate-_open_ path is never tested, and neither
  is any partial-evidence case (e.g. `status: "recorded"` with
  `gateEvidence: "unavailable"`, which must stay closed). A regression that
  opened the gate on `status === "recorded"` alone would pass the current suite.
- **Lines 73-74** — `establishProviderMapping`'s success path. No test asserts
  that a properly attested, owner-confirmed, non-conflicting mapping is actually
  admitted, nor that re-mapping within the same workspace is allowed.
- **Line 105** — the `tags`-absent fallback.

The three fail-closed claims STATUS.md makes for this module are asserted by
prose and by test _names_, not verified by assertions.

**Resolution (`8442699`):** `providerGateOpen`'s open path and each
partial-evidence case are now covered — a fully-recorded manifest opens the gate,
and dropping any single piece of evidence (`status`, `gateEvidence`, a missing or
empty `approvalReference`) closes it, as does a record for a different provider
and an empty manifest. The `tags`-absent fallback is covered incidentally by the
new status tests. File coverage moved from 92.95% lines / 75% branches to
**97.26% / 92%**.

Still open: `establishProviderMapping`'s success path (`demand-sources.ts:73-74`,
the sole remaining uncovered line) has no test asserting a properly attested,
owner-confirmed, non-conflicting mapping is admitted, nor that re-mapping within
the same workspace is allowed. Left deliberately — it belongs with finding #2,
which rewrites that function's conflict check.

## Quality gate

`pnpm install` then `pnpm quality` at repo root: **passes, exit 0** — format:check,
lint, build, typecheck, test:coverage (all six packages), pack:check, plugin:check.
`test/demand-sources.test.ts` runs in its new location (3 tests). All coverage
thresholds met as configured; none altered.

## Merge recommendation

**Safe to merge into 1.0-rc.** The branch adds an unreferenced pure-contract
module; it cannot change any existing runtime behavior, and the merge conflict was
additive and resolved without dropping anything. Quality is green.

Findings 1 and 5 are now fixed in `8442699` (see each finding for detail).
Findings 2, 3, and 4 remain tracked as follow-up on issue #10 rather than merge
blockers, since none is reachable while the module has no callers. They should be
closed before any provider ingress is wired to this module.

**Known flake, unrelated to this branch:** `packages/mcp-server/test/http.test.ts`

> "starts the local control plane when launched as the standalone HTTP package"
> intermittently fails with `ECONNREFUSED` on an ephemeral port — the spawned
> control plane is not always listening before the test fetches it. Observed once
> during this work, then 3/3 passes in isolation and a clean full-gate run. It
> cannot be caused by this branch (nothing consumes `demand-sources`), and it is not
> fixed here; it is a pre-existing startup race worth its own issue, since it will
> surface as random CI red.
