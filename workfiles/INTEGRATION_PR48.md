# PR #48 integration report — codex/issue-14-sdk-marketplace

Branch: `codex/issue-14-sdk-marketplace` merged with `origin/1.0-rc` (base `2ca6a55`).
Merge commit `614e6cd`, fix commit `763763b`, pushed.

## Merge conflicts

| File                         | Type             | Resolution                                                                                                                                          |
| ---------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts` | content conflict | Additive. Kept both `export * from "./replay-audit.js"` (1.0-rc) and `export * from "./sdk.js"` (branch), in alphabetical order. No export dropped. |
| `workfiles/ARCHITECTURE.md`  | auto-merged      | Both sections retained; branch's "SDK and marketplace foundation (issue #14)" appended after 1.0-rc's replay/audit section.                         |

`workfiles/STATUS.md` and `workfiles/CONFIGURATION.md` merged cleanly (branch does not touch them).
Verified post-merge: `git diff origin/1.0-rc -- <docs+index>` is purely additive (27 insertions, 0 deletions).

## Test verification (step 3 — anti-phantom-suite check)

- `packages/core`: **5 files / 56 tests collected and passed**, of which `test/sdk.test.ts` = **19 tests**.
  Counted by hand in the file: 8 + 9 (incl. `it.each` × 3) + 2 = 19. Matches.
- Barrel import verified explicitly at runtime in an isolated vitest root:
  `import * as m from "packages/core/src/index.js"` → **88 exports, no throw**, all 11 `sdk.ts`
  exports reachable (`SDK_CORE_VERSION`, `ConnectorManifestSchema`, `evaluateInstall`, `canInstall`,
  `canRunDuringMarketplaceOutage`, `requiresFreshConsent`, `isCompatible`, `CapabilitySchema`,
  `PublisherApplicationSchema`, `PublisherStateSchema`, `ReviewSchema`).
- Repo-wide: 202 tests across 6 packages, all passing.

## Defect fixed in-branch

### HIGH — `evaluateInstall` failed OPEN on an unparseable publisher review window

`packages/core/src/sdk.ts:319-320` (pre-fix):

```ts
if (new Date(input.review.reviewedAt) > now) reasons.push("publisher-review-not-yet-valid");
if (new Date(input.review.expiresAt) <= now) reasons.push("publisher-review-expired");
```

`new Date("not-a-date")` is `Invalid Date`; every relational comparison against it is `false`.
So a review with a garbage, empty, or out-of-range `expiresAt`/`reviewedAt` produced **no denial
reason at all**. Probed against the merged tree before fixing:

```
expiresAt: "not-a-date"            -> {"allowed":true,"reasons":[]}
expiresAt: ""                      -> {"allowed":true,"reasons":[]}
reviewedAt: "whenever"             -> {"allowed":true,"reasons":[]}
```

This contradicts the branch's own documented contract in `workfiles/ARCHITECTURE.md`
("Installation is fail-closed… A reviewed, **unexpired** publisher review… all required") and the
existing test title "reports publisher review state, activation, and expiry failures at the
injected time".

**Reachability:** latent today — `evaluateInstall` has no production caller yet; the SDK is a
contract-only module. It becomes reachable the moment any host passes a `review` record that was
not re-validated through `ReviewSchema` (e.g. a row read straight from the control-plane DB), which
is exactly the intended shape of the API. `InstallInput.review` is only a _compile-time_
`z.infer<typeof ReviewSchema>`; nothing enforces it at runtime.

**Fix:** treat a non-finite review timestamp as not-yet-valid / expired respectively. Reuses the
existing denial reason codes — no public API shape change, no new union members.

**Regression test:** `packages/core/test/sdk.test.ts` — "fails closed when a publisher review
carries an unparseable validity window" (6 cases). Verified it **fails** when the fix is stashed
(`Tests 1 failed | 18 passed`) and passes with it.

The existing "fails closed when the caller supplies an invalid evaluation time" test still expects
exactly `["evaluation-time-invalid"]`; the fix does not perturb it because the review timestamps in
that case are well-formed.

## Findings reported, NOT fixed (latent / out of scope)

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Reachability                                                                                                                |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | `evaluateInstall` never binds `input.review` to `input.manifest.publisherId`. A valid, unexpired review issued for publisher A authorizes publisher B's manifest — a confused-deputy path. Fixing needs `publisherId` on `ReviewSchema`, i.e. a public API shape change, which this task forbids.                                                                                                                                                                      | Latent (no caller). Becomes real on the first host integration; should be closed before any marketplace install path ships. |
| 2   | Medium   | The gate trusts caller-supplied booleans (`trust.signatureValid`, `trust.artifactTrustAvailable`, `exactDigestApproved`) with no binding to `manifest.entrypointDigest` / `signatureRef`. Nothing structurally prevents a caller from asserting `signatureValid: true` for a digest it never verified. Consistent with the "host-mediated" design and with ARCHITECTURE.md's "fail-closed until issue #8 artifact trust is available", but the contract is unenforced. | Latent / by design pending issue #8.                                                                                        |
| 3   | Low      | `UnboundedScopePattern` only matches `all\|any\|global\|unbounded`. Other generic sentinels (`everything`, `*.*` variants beyond the `*` check, `.`) pass. Docs say "generic unbounded sentinels" without claiming exhaustiveness.                                                                                                                                                                                                                                     | Latent, defence-in-depth only.                                                                                              |
| 4   | Low      | Unbounded collections in `ConnectorManifestSchema`: `dataHandling.classification`, `providerCompatibility` (key count and key content), and `dependencies` have no `.max()` and no control-character screen, unlike `scope.*` which is capped and screened. Parse-time memory amplification on hostile manifests.                                                                                                                                                      | Latent.                                                                                                                     |
| 5   | Low      | `requiresFreshConsent` considers only `scope` and capability expansion. Changes to `dataHandling.retention`/`classification`, `publisherId`, or `providerCompatibility` do not trigger re-consent. Not claimed by the docs, so not a contract violation — but a retention widening is a user-visible privacy change.                                                                                                                                                   | Latent.                                                                                                                     |
| 6   | Info     | `sdk.ts` branch coverage 95.38%; the two uncovered branches (lines 19, 270) are `?? 0` defensive fallbacks that are unreachable given the preceding regex validation. Not worth a test.                                                                                                                                                                                                                                                                                | n/a                                                                                                                         |

No test title was found asserting behaviour the implementation does not enforce (all 19 checked),
and nothing in the branch throws at module load.

## `pnpm quality`

**PASS, exit 0.** Three things had to be handled:

1. `format:check` failed on `packages/core/test/sdk.test.ts` (the branch's new file, plus my added
   test). Fixed with `pnpm format`.
2. Coverage thresholds passed without changes — `sdk.ts` is at 100% stmts / 95.38% branch /
   100% funcs. No threshold was touched.
3. The barrel export change made the tracked plugin bundles stale.
   `plugins/eventforge/server/eventforge-mcp-http.cjs` and `eventforge-standalone.cjs` regenerated
   via `pnpm --filter @eventforge/mcp-server bundle:plugin` (minifier identifier shifts from
   `sdk.js` entering the graph; `source.ingest.v1` now present in the bundle). Regeneration
   verified **deterministic** — two consecutive rebuilds produced byte-identical SHA-256:
   - `bab479e7…347c` `eventforge-mcp-http.cjs`
   - `faeb05a5…e8f5` `eventforge-standalone.cjs`

   The final `pnpm quality` run left the working tree clean, confirming stability.

No test was weakened, skipped, or deleted; no threshold lowered.

## Verdict

**Safe to merge PR #48 into 1.0-rc.** The merge is additive, the suite genuinely runs (56 core
tests, 19 of them the SDK's), quality is green end-to-end, and the one fail-open in the install gate
is fixed and pinned by a regression test. Findings 1 and 2 are real trust-boundary gaps but are
unreachable while the SDK has no caller; they must be closed before any host wires up
`evaluateInstall`, and both require API shape changes that belong in the issue #8 artifact-trust
work rather than in this integration.
