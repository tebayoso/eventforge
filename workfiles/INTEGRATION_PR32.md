# PR #32 — issue-23 notification sinks: integration + review

Branch `codex/issue-23-notification-sinks`. Code fix is `c4a8723`; all 7 checks were green on that
commit with the PR at `MERGEABLE / CLEAN`.

## Merge

No conflicts to resolve. The local worktree was 40 commits behind its own remote; fast-forwarded to
`origin/codex/issue-23-notification-sinks` (`de69860`), which already contained a merge of
`origin/1.0-rc` (`2ca6a55`). `git merge origin/1.0-rc` reported **Already up to date**. The additive
files called out for care (`packages/core/src/index.ts` barrel, `workfiles/STATUS.md`,
`CONFIGURATION.md`, `ARCHITECTURE.md`) needed no hand-resolution; the barrel keeps all 11 exports.

## Test collection (verified non-zero)

`@eventforge/core` collects **46 tests, 46 passed, 0 failed, 0 skipped** across 5 files.
`test/notifications.test.ts` contributes exactly **9** tests, matching its 9 `it()` blocks
(3 original + 6 added). Importing `@eventforge/core` through the barrel does not throw —
`dist/index.js` loads and exposes 86 exports including all 9 notification symbols. No schema or
top-level statement in `notifications.ts` executes at module load beyond `z` builder calls.

## Quality

`pnpm quality` at repo root: **exit 0** (format:check, lint, build, typecheck, test:coverage,
pack:check, plugin:check). `notifications.ts` coverage went 100/77.77 → **100% statements, branches,
functions, lines**; repo core branch coverage 85.98% → 87.29% against the 85% threshold. No test was
weakened, skipped, or deleted, and no threshold was lowered.

## Fixed in-branch (each with a regression test that fails on revert)

### 1. `js/polynomial-redos` + `js/incomplete-multi-character-sanitization` — HIGH — reachable via exported API

`safeNotificationText` filtered markup with `/<[^>]*>/g`. Two defects in one line:

- **Incomplete.** Removing `<x>` from `<x><script` reassembles a live tag, and `<` was never in the
  character-strip class at all, so `safeNotificationText("<script")` returned `<script` verbatim.
- **Quadratic.** Measured 10k `<` → 42ms, 20k → 136ms, 40k → 708ms, 200k → **22s**. `title` and
  `summary` are `z.string()` with no `.max()`, so payload size is unbounded.

Replaced with `stripBracketedMarkup`, a linear bracket-depth scan that drops every angle-bracket span
and every stray bracket. 200k `<` now returns `""` in ~4ms. Both alerts are **fixed, not suppressed**
— the CodeQL check went fail → pass and there are no open alerts on the file.

### 2. Routing metadata interpolated raw — HIGH — reachable via exported API

`renderNotification` sanitized only `title` and `summary`. `sourceCategory` (≤80), `lifecycleState`
(≤80) and `correlationId` (≤160) are free-form caller strings and were interpolated raw, so
`correlationId: "<!channel>"` rendered a Slack **mass-mention** and `"<https://evil.example|click>"`
rendered **provider link markup**. This contradicted three things at once: the doc ("neutralizes
mentions, links, markup"), the code comment ("cannot mention people or render provider markup"), and
the existing test title ("never embeds provider actions") whose assertions only inspected the title
and summary. All three fields now go through `safeNotificationText`.

### 3. Non-navigable deep-link schemes — MEDIUM — reachable via exported API

`z.string().url()` (zod 3.25.76) accepts `javascript:alert(1)`, `data:text/html,x`, `mailto:` and
`file:///etc/passwd` — verified. `eventforgeUrl` is the one field that must stay a live link, so it
cannot be run through `safeNotificationText`. Added a fail-closed guard in `validateNotificationRoute`
(the single gate `renderNotification` consults, so a caller that pre-checks suppression and a caller
that renders now agree): delivery is suppressed unless the deep link is an absolute `http(s)` URL
with a host.

### 4. `no-useless-escape` lint error — LOW — was blocking CI invisibly

The character class in the sanitizer's final replace failed `eslint --max-warnings 0`:

```
.replace(/[\\`*_~>|{}\[\]]/g, "")   // \[ is an unnecessary escape inside a class
```

This was masked in CI because `pnpm quality` chains with `&&` and `format:check` short-circuited
first — the branch had **two** independent Quality failures, not one. Fixed the escape; also dropped
the now-dead `>` from the class, since `stripBracketedMarkup` guarantees no `>` reaches it.

`workfiles/NOTIFICATION_SINKS.md` was updated so the documented contract matches the enforced one.

## Reported, not fixed (latent — no production caller exists)

`notifications.ts` has **no production caller**. It is referenced only by the barrel and its own test;
the only other repo hit for "notification" is an unrelated MCP `notifications/initialized` handler in
`apps/cloudflare/src/index.ts`, and the symbols do not appear in the plugin bundles. Everything below
is therefore latent until a delivery worker is written — but items 1–3 above were fixed anyway because
they sit in exported API that a worker will call on its first line.

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Medium   | **`renderNotification` never parses its inputs.** It trusts the TS types, which do not exist at runtime. A caller that skips `NotificationInputSchema`/`NotificationRouteSchema` bypasses every bound: `active: "false"` is truthy and passes the gate, `correlationId` can exceed 160 chars. The gate itself is correctly fail-closed for well-typed input — `provider` is a 2-value enum with both branches covered, and `botIsMember: undefined` blocks Slack. Not fixed: adding a parse would change the function's error contract. A delivery worker MUST parse before rendering. |
| L2  | Low      | **Deep-link host is unconstrained.** After the scheme fix, `https://evil.example/x` still renders as "Open in EventForge", which is a phishing primitive in an operator-facing message. Not fixed: there is no configured EventForge base URL anywhere in the repo to validate against. Needs a config value first.                                                                                                                                                                                                                                                                    |
| L3  | Low      | **Rendered text is not bounded end-to-end.** Every sanitized field is capped at 200 chars, but `eventforgeUrl` has no `.max()`, so the "bounded" claim in the doc holds only per-field.                                                                                                                                                                                                                                                                                                                                                                                                |
| L4  | Low      | **`logicalNotificationId` omits `route.id` and `workspaceId`.** Two distinct routes pointing at the same `destinationId` with the same version collapse to one logical id, so one silently dedupes away. Arguably intended; undocumented either way. No collision risk from the `join(":")` — `destinationId` is the only free-form field and it is last.                                                                                                                                                                                                                              |
| L5  | Cosmetic | **The sanitizer eats its own replacement tokens.** `[link]` and `[reference]` are inserted before the character-strip pass removes `[` and `]`, so output reads `link` / `reference`. Pre-existing on 1.0-rc for title/summary.                                                                                                                                                                                                                                                                                                                                                        |
| L6  | Cosmetic | **Fully-bracketed metadata renders as an empty label.** `sourceCategory: "<...>"` now yields `Source: ; verification: ...`. Correct (dropping markup beats emitting it) but reads oddly.                                                                                                                                                                                                                                                                                                                                                                                               |
| L7  | Cosmetic | Sanitizing `lifecycleState` strips `_`, so `pending_approval` renders as `pendingapproval`, while the unsanitized `eventType` enum keeps its underscore. Consequence of reusing the author's own sanitizer rather than inventing a second one.                                                                                                                                                                                                                                                                                                                                         |

## Repo-level finding, deliberately NOT folded into this PR

The tracked plugin bundles `plugins/eventforge/server/eventforge-{standalone,mcp-http}.cjs` are
**stale at HEAD**. Regenerating them from a clean tree at HEAD (before any of my edits) produces a
~90-line minifier-identifier diff, and both files are **byte-identical to `origin/1.0-rc`** — so the
staleness is inherited from 1.0-rc, not introduced here. Notification symbols do not appear in the
bundles at all, so the barrel change did not cause it. Regeneration is deterministic (verified
identical across two consecutive `pnpm plugin:check` runs). Left uncommitted: 1.8MB of churn in PR #32
would conflict with every branch integrated after it. **This belongs in a standalone commit on 1.0-rc.**

## Verdict

**Safe to merge into 1.0-rc.** Additive, self-contained, no public API shape change, no production
call path touched. The two CodeQL alerts are genuinely fixed, both Quality failures are resolved, and
the previously-unenforced parts of the branch's own documented contract are now enforced with tests.
The one thing an integrator must carry forward: **L1 — a delivery worker has to parse inputs through
the exported schemas before calling `renderNotification`**, because the render path does not.
