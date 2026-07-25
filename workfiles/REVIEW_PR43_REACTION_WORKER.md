# PR #43 integration review — codex/issue-20-reaction-worker

Reviewed: `git diff origin/1.0-rc...HEAD` (pre-merge contribution)
Merge commit: `f9a781b` · Fix commit: `5269199`
Quality: `pnpm quality` exit 0 at repo root.

## Merge conflicts resolved

| File                         | Resolution                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts` | Additive. Kept both barrel exports — `./reaction-worker.js` (ours) and `./replay-audit.js` (1.0-rc). No existing export dropped.                                                                                                                                                      |
| `workfiles/STATUS.md`        | Auto-merged, verified by hand. Our reaction-worker paragraph is a strict superset of the 1.0-rc sentence it replaces (it removes `reactions` from the not-supported list and adds durable reservation storage + reconciliation). The 1.0-rc issue #17 replay/audit section is intact. |

`workfiles/CONFIGURATION.md` and `workfiles/ARCHITECTURE.md` auto-merged without conflict; no content loss.

## Quality

Failed twice, fixed both, now passes:

1. **`format:check`** — the two new files were unformatted. Ran Prettier. Formatting-only; verified the test file has no logic change (`prettier(HEAD version) == current`).
2. **`build` / `tsc`** — genuine defect, see CRITICAL below. Fixed in `5269199`.

No test was skipped, weakened, or deleted. No coverage threshold touched. Core coverage after the fix: 95.19% stmts / 85.07% branch; `reaction-worker.ts` 90.24% / 73.91%.

## Findings

### CRITICAL — `ReactionActionSchema` threw at module load; branch was never executed

`packages/core/src/reaction-worker.ts:10`

`z.discriminatedUnion` reads the discriminator off each option's `.shape`. The `github.labels` option was wrapped in `.refine(...)`, producing a `ZodEffects`, which has no `.shape`. Constructing the schema threw `TypeError: Cannot read properties of undefined (reading 'type')` at import time.

Blast radius: `packages/core/src/index.ts` re-exports this module, so **any** import of `@eventforge/core` would throw at load — this would have broken the control plane, Cloudflare worker, and MCP server, not just the new code.

It also meant the branch's own test suite failed to collect. Confirmed: `numTotalTests: 0, numPassedTests: 0, numFailedTestSuites: 1`. The three tests in `reaction-worker.test.ts` had never run a single assertion, so none of the claimed fail-closed behaviour was ever verified.

Fixed by moving the constraint to an outer `superRefine` on the union, preserving the rejection. All 3 tests now execute and pass; the reservation logic they cover is verified sound.

### MEDIUM — kill-switch freshness check is one-sided, so a future timestamp defeats it — FIXED in `407f3d3`

`reaction-worker.ts:137` — `now.getTime() - authority.killEpochAt.getTime() > 30_000`

Only _past_ skew is bounded. A `killEpochAt` in the future yields a negative difference and passes. Verified: `killEpochAt = now + 24h` → `{allowed: true}`.

This is the kill-switch staleness guard. A clock-skewed or wrong-signed cache entry disables the 30s bound indefinitely rather than failing closed.

Fixed by comparing `Math.abs(killAgeMs)` and rejecting non-finite ages, so a future timestamp and an unparseable date both deny. Regression test: _"denies a kill cache dated in the future instead of trusting unbounded skew"_.

### MEDIUM — `reserveReaction` throws instead of returning a denial — FIXED in `407f3d3`

`reaction-worker.ts:116` (via `reactionHash` → `normalizedAction` / `.parse`)

The signature promises `Reservation` and the doc comment promises fail-closed reasons, but two paths throw instead:

- malformed envelope field (e.g. untrimmed `resource`) → `ZodError`. Verified.
- `github.labels` with the same label in `add` and `remove` → `Error("label cannot be both added and removed")`. Verified.

An exception is not a scope bypass, so this is not an authorization hole — but callers written against the declared return type will not have a `try`, so a malformed envelope crashes the worker instead of recording a denial, and a caller that _does_ catch reads it as a non-denial.

Fixed by returning `{allowed: false, reason: "envelope_invalid"}` from a `try` around the hash computation. Regression test: _"denies a malformed envelope instead of throwing past the guard"_. Side effect: because the schema parse now gates every later check, an invalid `expiresAt` can no longer slip past the `<= now` comparison as `NaN`.

### MEDIUM–LOW — `budgetClass` is never bound to `action.type`

Nothing checks that a `github.comment` effect carries a comment budget class. Verified: an envelope with `action.type = "github.comment"` and `budgetClass = "linear_effect"` returns `{allowed: true}`.

Budget is the abuse guard, so debiting the wrong bucket lets one class of effect drain another's allowance. Mitigating factor: `budgetClass` is inside the hash and therefore approval-bound, so this needs a buggy or malicious approval issuer rather than raw attacker input. Worth a schema-level cross-check regardless.

### LOW — `canonical()` sorts hash keys with `localeCompare`

`reaction-worker.ts:75`

`localeCompare` without an explicit locale is environment-dependent (default locale, ICU build). This is the key ordering for a security-critical deterministic hash; two nodes with different ICU could in principle disagree on a hash and reject each other's valid approvals. All current keys are ASCII identifiers so the practical risk is near zero, but `sort()` or explicit code-unit comparison is strictly safer and free.

### Verified sound (not defects)

- Approval binding is tight: hash, `approvalId`, `approvalVersion`, `approverId`, `active`, `used`, and exact `expiresAt` equality all checked. Content substitution is caught by `envelope_hash_mismatch`.
- Expiry comparisons use `<=`, so the boundary instant is denied.
- Provider/action-prefix consistency check is correct for all four combinations.
- Label canonicalization is order- and duplicate-insensitive as intended (`["a","b"]` and `["b","a","a"]` hash identically), and array element order is preserved elsewhere in `canonical()`.
- Missing `approval` or `authority` fails closed to `authority_unavailable`.

## Note unrelated to this branch

`pnpm quality` regenerates `plugins/eventforge/server/*.cjs`, and the rebuild produces a 216-line minifier diff against what 1.0-rc has committed. Reproduced from a clean checkout of those files, so the checked-in bundles are stale on 1.0-rc independently of this branch (which touches only `packages/core`). I reverted the regenerated artifacts rather than commit unrelated churn into this PR. Worth a separate look.

## Verdict

**Safe to merge into 1.0-rc as of `407f3d3`** — but it would not have been safe at `a7ef1ed`: that commit would have broken every consumer of `@eventforge/core` at import time.

The two fail-open findings above are fixed and covered. The remaining two — `budgetClass` not bound to `action.type`, and `localeCompare` key ordering — are deliberately deferred to the issue #20 follow-ups. Neither is exploitable today: this slice has no provider writer, no credentials, and no durable reservation store, so nothing reaches a real effect. Both should be closed before a writer is wired up.

Core suite after the fixes: 42 tests collected and passing in `packages/core` (5 in `reaction-worker.test.ts`); `reaction-worker.ts` coverage 93.84% stmts / 76.92% branch, up from 90.24 / 73.91.
