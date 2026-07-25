# PR #38 (codex/issue-5-policy-packs) — 1.0-rc integration and review

Merge commit: `896f861` · fix: `0289f60` · bundles: `786cbeb`
`pnpm quality` at repo root: **exit 0**, working tree clean.

## 1. Conflict resolution

`git merge origin/1.0-rc` produced two conflicts. `app.ts` and `contracts.ts` auto-merged
and were verified by hand afterwards.

| File                              | Conflict                                    | Resolution                                                   |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `packages/core/src/index.ts`      | Both sides added export                     | Additive — kept both `policy-packs.js` and `replay-audit.js` |
| `packages/core/test/core.test.ts` | Both sides added tests at top of `describe` | Additive — kept both blocks, all 4 tests retained            |

### Real collision behind the barrel conflict

Keeping both exports surfaced a genuine name clash that the textual conflict hid:
**both new modules export `canonicalManifest`** —
`replay-audit.ts` (1.0-rc) for `ExportManifest`, `policy-packs.ts` (branch) for
`PolicyPackManifest`. Different signatures, different purposes.

Resolved by **renaming the newer one** to `canonicalPolicyPackManifest`, since 1.0-rc's
version was pre-existing with three internal consumers (`exportHtml`,
`createEvidenceExport`, `verifyExport`) while the branch's had two. Neither export was
dropped.

### Auto-merge verification

Confirmed no 1.0-rc content was lost: `git diff -U0 origin/1.0-rc..HEAD` shows **zero**
removed lines in `contracts.ts`, `index.ts`, `STATUS.md`, `CONFIGURATION.md`, and
`ARCHITECTURE.md`. The only removals anywhere are the four intentional lines in `app.ts`
where the branch replaces the ad-hoc policy hash with the canonical digest.

`CONFIGURATION.md` / `ARCHITECTURE.md` did not actually conflict — this branch never
touched them.

`app.ts` route table checked for collisions: 21 route registrations, all distinct. Both
`evaluatePolicy` call sites (lines 410, 848) are fail-closed — deny returns early with no
proposal created, or a 403.

## 2. Defect fixed in-branch

### `simulatePolicy` claimed complete coverage for zero evaluations — MEDIUM

`packages/core/src/policy-packs.ts:82`

```js
// before
status: evaluated === inputs.length ? "complete" : evaluated ? "partial" : "blocked",
```

With an empty input set, `evaluated === inputs.length` is `0 === 0` → **`"complete"`**.
Reproduced against the built package:

```
simulatePolicy(manifest, []) -> {"status":"complete","evaluated":0,"eligible":0,"decisions":[]}
```

This contradicts the branch's own documented contract in `workfiles/STATUS.md`:

> Missing retained evidence and authorization produce blocked/partial coverage rather
> than a complete claim.

A hosted simulation job that retrieves zero retained-evidence rows — precisely the
retention gap `POLICY_PACK_DEPENDENCIES.md` marks as `Missing` — would record
`status='complete'` with `coverage_denominator=0` in `eventforge_policy_simulations`,
reporting a fully-simulated pack that evaluated nothing. Fail-open in coverage reporting.

**Fix:** zero evaluations always yields `blocked`. Behavior for non-empty inputs is
unchanged (`evaluated === 0` already mapped to `blocked`; the other two arms are
untouched).

**Regression test:** `"never reports complete simulation coverage without evaluating
retained evidence"`. Verified it fails when the fix is reverted:
`expected { status: 'complete' } to match object { status: 'blocked' }`.

**Reachability:** latent today — no hosted route calls `simulatePolicy` yet. But it is
exported from the public core barrel and is the documented Phase B entry point, and the
fail-closed guarantee is the entire claim of the accompanying docs.

## 3. Test coverage added

`policy-packs.ts` was the weakest module at **73.77% stmts / 73.07% branches**, with every
uncovered line being a fail-closed path. The branch's own test titled _"blocks unretained
evidence and untrusted **or incompatible** signed imports"_ never exercised the
incompatible-evaluator branch, and the signature-verification path was **completely
untested** (the existing test short-circuits at `untrusted_signer` with `trust: []`).

Added coverage for: `incompatible_evaluator`, revoked signer, `expired` manifest,
`input_limit_exceeded`, `authorization_lost`, valid-signature acceptance, and
cross-manifest signature reuse.

`policy-packs.ts`: **100% stmts / 97.22% branches**. Core overall branches 86.09 → 87.68
(threshold 85). No test weakened, skipped, or deleted; no threshold lowered.

## 4. Review findings — reported, not fixed

Empirically probed `crypto.verify` failure modes rather than reasoning about them.

| #   | Finding                                                                                                                                                                                                                                                                                                                    | Severity | Reachability                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `verifyPackImport` passes `algorithm=null` to `crypto.verify`, which only validates Ed25519/Ed448. Verified: an RSA or EC P-256 trusted key returns **`false`**, so every legitimately-signed pack is rejected as `invalid_signature` with no diagnostic distinguishing "wrong key type" from "forged signature".          | Medium   | Latent — fail-closed (denies), so not a security hole. Becomes a live operability trap once the workspace trust store lands. Fixing implies designing algorithm negotiation, out of scope here. |
| 2   | A malformed or empty `publicKey` in the trust store makes `verify` **throw** `ERR_OSSL_UNSUPPORTED` uncaught, rather than returning a clean denial.                                                                                                                                                                        | Low      | Latent — trust-store content is admin config, not attacker input. Confirmed **not** attacker-reachable: malformed/empty/oversized _signatures_ all return `false`, never throw.                 |
| 3   | `reasonCodes` is derived by prefix-matching human-readable reason **strings** (`reason.startsWith("Capability")`), with a catch-all `"repository_required"` fallback. The mapping is correct for all 7 reasons produced today, but any new reason string silently mislabels as `repository_required`.                      | Low      | Latent — decisions still deny correctly; only the emitted reason code would be wrong.                                                                                                           |
| 4   | `matchedRuleIds` is `allowed ? ["execution-policy-v1"] : []` — a deny is also produced by matching a rule, so an audit consumer sees no rule attributed to any denial. `outcome`'s `"invalid"` / `"unmatched"` and `simulatePolicy`'s `"cancelled"` are declared but never produced.                                       | Low      | Latent — declared-for-future states.                                                                                                                                                            |
| 5   | The branch introduces a canonical content digest (`policyDigest`) and stores it as `policySnapshotHash`, but the approval path at `app.ts:847` still gates staleness on `policyVersion` equality alone and never compares the digest. Same-version content mutation is caught only by the re-evaluation of current policy. | Low      | Latent — defense-in-depth gap, not a hole; re-evaluation covers the semantics.                                                                                                                  |
| 6   | `eventforge_policy_simulations` has PK `id uuid` and no index on `workspace_id`, unlike sibling tables in `003_commercial_platform.sql` which all carry explicit workspace-scope indexes.                                                                                                                                  | Low      | Latent — no migration runner exists in `src`; migrations are declarative until PostgreSQL is wired.                                                                                             |

### Checked and found sound

- **`policySnapshotHash` formula change** (`JSON.stringify` insertion-order → canonical
  sorted digest). Grepped all consumers: the value is **written only**, never recomputed
  and compared, and its schema is `z.string().min(1).default("legacy")`. Safe, and
  strictly more correct than order-dependent hashing.
- **`PolicyDecisionSchema` gained 9 required fields.** It is never `.parse()`d anywhere —
  type-only. No runtime validation break for older persisted decisions.
- **No sign/verify split-brain.** `manifestDigest` and the signature check both canonicalize
  via the same `canonicalPolicyPackManifest(input.manifest)`, so the hashed bytes and the
  signed bytes cannot diverge.
- **`digest()` canonicalization** in `workflows.ts` recursively key-sorts through nested
  objects and objects inside arrays. Correct.
- **Migration 004** is consistent with repo convention (no RLS anywhere; isolation is
  enforced in application code), uses tenant-composite keys, `check` constraints matching
  the Zod enums, and a `unique (workspace_id, manifest_digest)` content-address constraint.

## 5. Plugin bundles

The tracked `.cjs` bundles under `plugins/eventforge/server/` regenerated. The diff is
minifier identifier churn (`sH`, `_g`, …) from the enlarged module graph — the policy-pack
code itself is tree-shaken out and absent from both bundles. Regeneration is
**deterministic**: identical MD5s across two independent rebuilds. `plugin:check` passes
(9 MCP tools initialized). CI only gates `eventforge-mcp.mjs`, which is unchanged;
committed the `.cjs` files anyway so the next `pnpm quality` does not produce a dirty tree.

## 6. Verdict

**Safe to merge into 1.0-rc.** The merge preserves both sides in full, the one real
collision is reconciled without dropping either export, the full quality gate passes from
a clean tree, and the one fail-open defect is fixed with a verified regression test. All
six remaining findings are latent and fail-closed; none blocks the merge. The branch adds
no hosted route, so its production reachability is limited to the `policyDigest`
substitution in the existing proposal path, which is write-only provenance.
