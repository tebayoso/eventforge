# Connector trust review — PR #51 integration (2026-07-25)

Branch `codex/issue-8-forge-connectors` merged with `origin/1.0-rc`. The branch's own
contribution (`git diff origin/1.0-rc...HEAD`, 326 lines) had never been reviewed.

## Merge conflicts

| File                                | Resolution                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`        | Additive — kept both `./connector-trust.js` (branch) and `./durable-delivery.js` (1.0-rc).                  |
| `workfiles/agent-browser/README.md` | Additive — kept all three 1.0-rc playbook entries plus the branch's GitHub publish check, retitled to `##`. |
| `workfiles/STATUS.md`               | Auto-merged; both sides' entries verified present.                                                          |

`CONFIGURATION.md` and `ARCHITECTURE.md` did not conflict.

## Verification

- Core suite collects **46 tests across 5 files**, of which `connector-trust.test.ts`
  contributes **9** (3 original + 6 added) — matching its 9 `it()` blocks. Non-zero and
  matched; no silent zero-collection.
- Importing `@eventforge/core` through the barrel does not throw at module load
  (verified by dynamic import of `packages/core/src/index.js`, and implicitly by the
  whole suite, which imports through the barrel).
- `pnpm quality` exits **0** (format:check, lint, build, typecheck, test:coverage,
  pack:check, plugin:check). `connector-trust.ts` at 98.91% lines / 84.21% branches;
  package aggregate 95.88 / 86.08 against thresholds of 90 / 85. No threshold lowered,
  no test skipped or deleted.
- Tracked plugin `.cjs` bundles regenerated. The churn is **merge-induced, not
  fix-induced**: bundles built from the merge alone and from the merge plus fixes hash
  identically (`a52de4b1…`), and connector-trust is tree-shaken out of the bundle
  entirely. Two consecutive builds produce the same hash — deterministic.
- Each fix was mutation-tested: reverting it makes 1–3 tests fail.

## Fixed in-branch

### 1. Expiry gates failed open on unparseable timestamps — HIGH

`Date.parse("junk")` is NaN and every NaN comparison is false, so
`Date.parse(value) <= now` reads junk as _not yet expired_. All three expiry gates were
written that way:

- `createManifest` accepted `expiresAt: "not-a-date"` — the "must be in the future"
  guard never fired.
- `verifyEnvelope` then accepted that manifest **in year 2099**, alongside a signer whose
  `validUntil` was equally unparseable.
- `approvalEligible` treated an approval with unparseable `expiresAt` as never expiring.

Directly contradicts STATUS.md's documented "signer revocation/expiry checks". Fixed by
routing all three through a `validAt` helper requiring a finite, future timestamp.

### 2. Signed payload unvalidated + vacuous digest binding — HIGH

`verifyEnvelope` did `JSON.parse(...) as ConnectorManifest` with no schema check, so a
signed manifest could carry absent or malformed security subjects. `approvalEligible`
then compared digests with `===`, so a manifest with no subjects and an approval with no
digests bound vacuously (`undefined === undefined` → approved). That defeats the
"exact-digest approval binding" STATUS.md documents. Fixed on both sides:
`verifyEnvelope` now enforces the same eight-SHA-256-subject invariant `createManifest`
already applies, and `approvalEligible` requires both sides to be real SHA-256 values.

### 3. Branch failed `pnpm lint` as pushed — MEDIUM (process)

`as any` in the test fixture (present in `5190f02`) trips
`@typescript-eslint/no-explicit-any` and blocks the repo quality gate. Replaced with the
exported `ConnectorSubjects` type.

### 4. Test title asserted an unasserted behavior — LOW

`"binds approval to every mutable security subject"` never checked any of the five digest
comparisons. Added per-digest assertions; dropping any one comparison from the
implementation now fails the test by name.

**Reachability of 1 and 2:** reachable through the published public API of
`@eventforge/core` (the module is barrel-exported), but there is currently **no in-repo
call site** — so not yet reachable from a running production path. They are pre-positioned
defects: the first consumer inherits them.

## Reported, not fixed (latent)

| #   | Finding                                                                                                                                                                                                                                                                      | Severity | Reachability                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | `createManifest` calls `ConnectorScopeSchema.parse(input.scope)` and **discards the result**, storing the raw input. Unknown scope keys (which zod strips) survive into the signed manifest, and schema defaults are never materialized.                                     | MEDIUM   | Latent. The gate still throws on invalid scope, so not fail-open. Fixing changes manifest digests — deliberate follow-up, not a merge blocker.                    |
| 6   | `installEligible` checks `provider.available` but never calls `validationGate` or requires `state === "passed"`. A provider reporting available while returning `blocked` would pass install eligibility.                                                                    | MEDIUM   | Unreachable today — `DenySandboxProvider` is the only implementation (`available: false`) and has no callers. Becomes fail-open the moment a real provider lands. |
| 7   | `ConnectorScopeSchema.runtime`'s default `{cpuMs: 0, memoryMb: 0, pidLimit: 0, timeoutMs: 0}` violates its own `.positive()` constraints, so a scope omitting `runtime` is _always_ rejected and the default is dead code.                                                   | LOW      | Latent, fail-closed direction.                                                                                                                                    |
| 8   | Only `critical` findings block approval — a `high` finding (e.g. RCE) passes. Matches STATUS.md's "critical-finding blocks" wording, so no contract contradiction, but worth an explicit policy decision.                                                                    | LOW      | Latent policy gap.                                                                                                                                                |
| 9   | `it("rejects revoked signers")` mutates the module-level `signers` map, permanently revoking `key-1` for anything ordered after it. New tests deliberately build independent signer maps.                                                                                    | LOW      | Test fragility only.                                                                                                                                              |
| 10  | `Signer.publicKey` is typed `string \| Buffer`, but Node's `KeyObject` — what `generateKeyPairSync` returns and what `verify()` accepts — is not in the union. CI never sees it: `packages/core/tsconfig.json` includes only `["src"]`, so test files are never typechecked. | LOW      | Type-accuracy gap; also means test-only type errors cannot fail `pnpm typecheck`.                                                                                 |

## Verdict

PR #51 is **safe to merge into 1.0-rc**. The two fail-open gates are closed with
mutation-tested regressions, `pnpm quality` is green, and the remaining findings are
latent — none is reachable from a production path today, because nothing calls the module
yet. Findings 5 and 6 should be resolved before the first real sandbox provider or
connector install path is wired up.
