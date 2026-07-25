# PR #39 (codex/issue-19-timeline) — integration and review

Integrated `origin/1.0-rc` into `codex/issue-19-timeline`. `pnpm quality` passes (exit 0).
`origin/1.0-rc` is an ancestor of the branch head. Not merged into `1.0-rc` — serial
integration remains the coordinator's.

## Conflict resolutions (all additive, nothing dropped)

| File                                                        | Conflict                                                                                                                                 | Resolution                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`                                | Both sides inserted a barrel export at the same line: `./timeline.js` (branch) vs `./replay-audit.js` (1.0-rc)                           | Kept both, alphabetically. Verified no export-name collision between `timeline.ts` and `replay-audit.ts` — an ambiguous `export *` would have silently produced `undefined` at runtime.                                                                                                                                      |
| `apps/control-plane/migrations/003_commercial_platform.sql` | Both sides appended a new table at EOF: `eventforge_timeline_entries` (branch) vs `eventforge_github_installations` + 2 indexes (1.0-rc) | Kept both. 1.0-rc's block first (already integrated), branch's timeline table appended after. **No statement reordered, renumbered, or rewritten**; no existing migration renumbered. Every statement in this file is `create … if not exists`, so re-running an already-applied 003 to pick up the new table is idempotent. |
| `workfiles/STATUS.md`                                       | Adjacent new sections                                                                                                                    | Kept both sections.                                                                                                                                                                                                                                                                                                          |
| `workfiles/ARCHITECTURE.md`, `workfiles/CONFIGURATION.md`   | Auto-merged                                                                                                                              | Verified both sides' sections survive.                                                                                                                                                                                                                                                                                       |

Tracked plugin bundles (`plugins/eventforge/server/*.cjs`) were regenerated. They were
**already stale from the merge itself** — the same 204/204 diff appears with my source
changes stashed — so this is merge fallout, not fix fallout. Regeneration is deterministic:
two consecutive `bundle:plugin` runs produce byte-identical output. Timeline symbols are
tree-shaken out of the bundles (no MCP surface).

## Defects fixed in-branch

### 1. `timelineIntegrityHash` was not deterministic — HIGH, latent

`canonicalJson` carries the doc comment `/** RFC 8785-compatible … */` but ordered object
members with `localeCompare`. Two independent problems:

- **Not RFC 8785.** The RFC mandates UTF-16 code-unit order. Observed:
  `canonicalJson({b,A,_,Z,a})` produced `{"_","a","A","b","Z"}` where the RFC requires
  `{"A","Z","_","a","b"}`. The hash was never interoperable with any conforming
  implementation, contradicting the branch's own "standalone verifier" claim.
- **Insertion-order dependent.** `localeCompare` returns `0` for _distinct_ strings
  (verified: NFC `U+00E9` vs NFD `e`+`U+0301`; also `"a�"` vs `"a"`). With a
  zero comparator result, V8's stable sort preserves insertion order, so the same logical
  key set hashed differently depending on property insertion order. `timelineIntegrityHash`
  was a function of the value _plus insertion order_, and `verifyTimelineArtifact` could
  return `false` for a genuine manifest. This directly contradicts the branch's own test
  title "is repeatable" and STATUS.md's "deterministic canonical manifest hashing".

Fixed by comparing code units (`a < b ? -1 : a > b ? 1 : 0`). Fail direction was closed
(false rejection, not false acceptance), so this is an integrity/interop break rather than
a forgery path. Note `stableJson` in `replay-audit.ts` (1.0-rc, pre-existing) has the same
`localeCompare` pattern — left untouched as out of scope, but flagged below.

### 2. `renderTimelineHtml` interpolated unescaped values — HIGH, latent

`entry.id`, `kind`, `uncertainty` and `redaction` went into markup and into
double-quoted attribute values with no escaping and no schema validation. Verified
payload:

```
id: "<script>alert(1)</script>", uncertainty: '" onmouseover="steal()'
```

produced a live `<script>` element and broke out of `data-timeline-uncertainty`, emitting
an attacker-controlled `onmouseover` handler. That also violates the manifest's own
`fieldMap` contract, which promises each value stays inside its named attribute.

Exploitability is not hypothetical in the intended architecture: `uncertainty` and
`redaction` have **no columns and no check constraints** in the migration — they live inside
the unconstrained `data jsonb` blob — and nothing anywhere calls `TimelineEntrySchema.parse`.
Only `kind` is enum-checked in SQL.

This also deviated from the codebase's own established convention: 1.0-rc's `exportHtml`
escapes every interpolated value via `escapeHtml` and validates first via
`validateExportManifest`. Fixed by escaping all interpolated values with a local
`escapeHtml` mirroring the `replay-audit.ts` helper (kept local rather than exported to
avoid refactoring just-landed 1.0-rc code).

**Reachability for both:** latent. There is no production caller — `grep` finds timeline
references only in `dist/` build output. Both are exported from the public
`@eventforge/core` barrel and become reachable the moment #7 lands a hosted endpoint.

### Regression tests

Three tests added to `packages/core/test/timeline.test.ts`; each verified to fail when its
fix is reverted (confirmed by reverting each fix independently):

- code-unit ordering vs collation ordering → fails on revert
- insertion-order independence for collation-equal keys → fails on revert
- markup and attribute escaping → fails on revert

The pre-existing test `"sorts object keys for canonical bytes"` used `{b:1,a:2}`, which
passes under _both_ orderings — its title asserted a property the implementation did not
enforce. It was kept as-is and the two stronger ordering tests were added alongside it.
The `entry` fixture gained the `uncertainty`/`redaction`/`versionRefs` fields that
`TimelineEntry` requires (they have zod `.default()`s, so the inferred output type demands
them); no assertion was weakened, skipped, or removed, and no coverage threshold was changed.

## Findings reported, not fixed

| #   | Severity      | Reachability            | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | Medium        | Latent, design decision | `redactTimelineEntry` replaces only `metadata`. `origin`, `actorId`, `sourceAt`, `causalParentId`, `canonicalEventId`, `authoritativeForId`, `versionRefs` and `integrityHash` all survive redaction — including for `redaction: "deleted"`. A "deleted" entry still discloses actor identity and full provenance links. Whether that is intended is a contract question for #13/#17 (erasure/revocation) and should be settled before any hosted export exposes it. Not fixed: it is a design choice, not an implementation error. |
| 4   | Low           | Latent                  | `renderTimelineHtml` and `timelineManifest` accept `TimelineEntry` as a _type_ only; nothing calls `TimelineEntrySchema.parse`. Escaping now makes rendering safe, but adding a `validateExportManifest`-style guard would additionally enforce the uuid/enum/hash-format contract at the boundary, matching `exportHtml`.                                                                                                                                                                                                          |
| 5   | Low           | Latent                  | Migration/TS drift. The SQL table has columns for only a subset of `TimelineEntry`; `origin`, `uncertainty`, `redaction`, `actorId`, `versionRefs`, `metadata`, `sourceAt` have no columns and no constraints, living in `data jsonb`. The absent check constraints on `uncertainty`/`redaction` are what made finding #2 exploitable. Consider promoting the two enum fields to checked columns.                                                                                                                                   |
| 6   | Low           | Latent                  | `verifyTimelineArtifact` compares hashes with `===` (not constant-time). Not a real vector here — this is an unkeyed digest of public data, not a MAC — and 1.0-rc correctly uses `timingSafeEqual` for the keyed `HmacExportIntegrity`. Noted only so the distinction stays deliberate if a keyed signature is added under #17.                                                                                                                                                                                                    |
| 7   | Low           | Latent                  | `canonicalJson` throws on `undefined` property values. Direction is fail-closed (correct), but a zod-parsed entry with an explicitly-passed `causalParentId: undefined` throws rather than hashing, since zod retains explicitly-provided undefined optional keys.                                                                                                                                                                                                                                                                  |
| 8   | Informational | Pre-existing in 1.0-rc  | `stableJson` in `replay-audit.ts:762` sorts with `localeCompare` and has the same insertion-order-dependence as finding #1. Out of scope for this branch (1.0-rc code, and `pnpm quality` passes), but it backs `canonicalManifest`/`createEvidenceExport` and warrants the same one-line fix. **Recommend a separate follow-up.**                                                                                                                                                                                                  |
| 9   | Informational | —                       | `eventforge_timeline_entries` declares both `id uuid primary key` and `unique (workspace_id, id)`. Redundant, harmless; plausibly deliberate for tenant-scoped upserts. No RLS policy, consistent with the other tables in this file (tenancy is enforced app-side).                                                                                                                                                                                                                                                                |

## Verdict

**Safe to merge into 1.0-rc.** `pnpm quality` passes at exit 0. Both HIGH findings are fixed
with reverting regression tests, and both were latent — no production code path reached
them, so nothing shipped was affected. The remaining findings are latent hardening and
design items that belong with the #7/#13/#17 work the branch itself declares as blocking,
with one exception worth the coordinator's attention: **finding #8 is the same
determinism defect in 1.0-rc's own `stableJson`**, which does back live export helpers and
should get its own follow-up fix.
