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

### 1. MEDIUM — Datadog `status` is not allowlisted, contradicting its own test

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

Recommended: allowlist the discrete transition statuses the same way
`supportedEventMatrix` allowlists event names, and rewrite the test to assert a
non-allowlisted status is rejected. I did not apply this — which statuses belong
in the set is a product decision on the provider contract, and step 3 of my
dispatch was to report, not to change semantics on a security boundary.

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

### 5. LOW — the fail-closed gate's discriminating cases are untested

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

## Quality gate

`pnpm install` then `pnpm quality` at repo root: **passes, exit 0** — format:check,
lint, build, typecheck, test:coverage (all six packages), pack:check, plugin:check.
`test/demand-sources.test.ts` runs in its new location (3 tests). All coverage
thresholds met as configured; none altered.

## Merge recommendation

**Safe to merge into 1.0-rc.** The branch adds an unreferenced pure-contract
module; it cannot change any existing runtime behavior, and the merge conflict was
additive and resolved without dropping anything. Quality is green.

Findings 1-5 should be tracked as follow-up on issue #10 rather than treated as
merge blockers, since none is reachable while the module has no callers. Finding 1
must be closed **before** any Datadog ingress is wired to
`normalizeDatadogMonitorTransition`, and finding 5 should be closed alongside it —
a fail-closed gate whose open path has never been executed is not yet
demonstrated to be fail-closed.
