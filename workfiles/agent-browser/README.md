# EventForge browser playbook

## 2026-07-17 — Operations console acceptance flow

- Started the control plane with `EVENTFORGE_DEMO_MODE=true pnpm --filter @eventforge/control-plane start` and the console with `pnpm --filter @eventforge/console dev`.
- Opened `http://localhost:5173` in the `eventforge-qa` agent-browser session and verified the command center, connector health, empty approval state, and Forge Studio rendered correctly.
- Selected **Run GitHub CI demo**. Outcome: a normalized `github:check_run` demo event appeared, the CI-investigator run was created, private project memory was written, and a pending PR proposal surfaced.
- Opened the proposal and selected **Approve action**. Outcome: the dialog closed, the approval queue cleared, and the audit timeline recorded the reviewer decision; no automatic provider write occurred.
- Selected **Forge draft**, then **Approve artifact**. Outcome: the generated Linear/GitHub connector showed its requested scopes and reached `approved`; the UI explicitly states installation remains a separate local action.
- Selected **Linear event** and **Sentry alert**. Outcome: both normalized demo events appeared in the live feed; no unmatched workflow created a write proposal.
- Screenshots captured during the run: `/tmp/eventforge-console.png`, `/tmp/eventforge-approved.png`, and `/tmp/eventforge-forge-approved.png`.

Reusable pattern: snapshot interactive elements before each click, resnapshot after every UI update, and assert the audit trail/approval queue instead of assuming a click caused an external write.

## 2026-07-17 — Live GitHub relay acceptance flow

- Started `pnpm dev:github`, which generated an ignored local signing secret, created GitHub webhook `#653895042`, and forwarded `check_run` deliveries from a disposable Smee channel to `http://127.0.0.1:4310/webhooks/github`.
- Dispatched the manual-only **EventForge CI failure demo** workflow at `https://github.com/tebayoso/eventforge/actions`. Outcome: the workflow failed intentionally and GitHub delivered both queued and completed `check_run` events.
- Verified `http://127.0.0.1:4310/events` recorded the completed delivery as `signatureStatus: verified`, and `http://127.0.0.1:4310/actions` contained a pending remediation proposal rather than an automatic write.
- Attempted to reopen `http://localhost:5173/` in the Codex in-app browser. The runtime reported stale tab ownership after the prior tab cleanup, so browser assertions were not reused; the API-level acceptance evidence above remains valid.

Reusable pattern: for live webhook testing, keep the relay process open until the provider job reaches completion, then verify both the provider run and the local event/action APIs. If the in-app browser reports stale tab ownership, start a fresh browser session before relying on it for UI assertions.

## 2026-07-17 — Cloudflare Quick Tunnel webhook flow

- Started `pnpm dev:github`. EventForge launched `cloudflared` with an empty configuration, waited for the temporary `trycloudflare.com` health check to respond, then patched the existing GitHub webhook rather than creating a new one.
- Confirmed the stored public endpoint in `.eventforge/github-local-webhook.json` matched GitHub webhook `#653895042` and that the tunnel served `/health` successfully.
- Dispatched **EventForge CI failure demo** again. Outcome: GitHub completed the intentional failure, EventForge recorded a `verified` failed `check_run`, and the remediation action remained `pending`.

Reusable pattern: Quick Tunnel URLs change on each launch. Do not dispatch a provider test until the tunnel health check returns 200 and GitHub's webhook configuration matches the stored public `/webhooks/github` endpoint. Always run Quick Tunnels with an empty cloudflared config when the developer machine has unrelated named tunnels.

## 2026-07-17 — GitHub issue to Codex review flow

- Created GitHub issue [#1](https://github.com/tebayoso/eventforge/issues/1) with an explicit no-write review request. GitHub delivered the signed `issues` event to EventForge.
- Confirmed the first implementation correctly started Codex thread `019f71ce-21ca-7001-9c77-2b30380e0ae1` and created no action, but GitHub timed out because the webhook response waited for the 24-second Codex review.
- Changed verified webhook processing to enqueue the workflow and acknowledge it immediately. Redelivered the same GitHub delivery: GitHub recorded HTTP `202`, and EventForge completed fresh persisted thread `019f71cf-98c8-7213-ace1-ed7d293e90a1` with an assessment and an empty action queue.
- Opened that thread in the Codex desktop app. The review identified the event as a test-only request and retained the read-only policy.

Reusable pattern: after opening a test issue, confirm the GitHub delivery is `202` before waiting for `/runs` to become `completed`; then assert `/actions` is an empty array. A slow agent must never delay the provider acknowledgment.

## 2026-07-17 — Console theme switcher smoke flow

- Started the Vite console and opened `http://127.0.0.1:5173/` in the `eventforge-theme-smoke` agent-browser session.
- Took an interactive accessibility snapshot. Outcome: the header exposed native buttons named **Use light theme** and **Use dark theme**, alongside the existing refresh control.
- Activated **Use dark theme** and verified `localStorage.eventforge-theme` became `dark`; captured `/tmp/eventforge-console-dark.png`.
- Focused **Use light theme** and pressed Space. Outcome: keyboard activation changed the page back to `light`, persisted `localStorage.eventforge-theme: light`, and the selected button reported `aria-pressed="true"` while the other reported `false`; captured `/tmp/eventforge-console-light.png`.
- Reloaded the console. Outcome: the document `data-theme`, CSS `color-scheme`, and saved preference all remained `light`. Browser error inspection was empty.
- Repeated the keyboard switch at a 375px viewport after the responsive-header adjustment. Outcome: **Use dark theme** remained discoverable by its accessible name, Space selected it, and the document width stayed equal to the 375px viewport (no horizontal overflow).

Reusable pattern: snapshot before every theme action, verify the selected button's `aria-pressed` state plus local storage, then reload to confirm the early initializer applies the persisted theme without waiting for React.

## 2026-07-17 — Cloudflare deployment CORS smoke flow

- Started an isolated control plane at `http://localhost:4311` with `EVENTFORGE_ALLOWED_ORIGINS=http://localhost:5174`, then served the Vite console at `http://localhost:5174` with `VITE_EVENTFORGE_API_URL=http://localhost:4311`.
- Opened the console in the `eventforge-cloudflare-smoke` agent-browser session. The command center, connector health, approval queue, and Forge Studio rendered; the browser console reported no application errors.
- Selected **Run GitHub CI demo**. Network evidence showed credentialed cross-origin preflights returning `204`, followed by the `POST /events/demo` returning `202` and console refresh requests returning `200`. The pending remediation proposal appeared in the approval queue.
- Screenshot captured at `/tmp/eventforge-cloudflare-cors-smoke.png`. A local `favicon.ico` request returned `404`; it did not affect the application flow.

Reusable pattern: test cross-origin production-style console wiring on isolated local ports, set the exact console origin in `EVENTFORGE_ALLOWED_ORIGINS`, and assert both the browser's preflight/POST sequence and the resulting approval state. Do not use this local test as evidence of Cloudflare Access, DNS, Tunnel, or custom-domain configuration.

## 2026-07-17 — EventForge landing-page validation

- Started the Vite console at `http://127.0.0.1:5176` and opened `/` in the `eventforge-landing` agent-browser session.
- Verified the landing page title, navigation, hero “Autonomy needs a witness,” the investigation trace, principles, decision ledger, and final console CTA rendered in the accessibility tree. Browser console showed only Vite/React development messages, with no application errors.
- Captured the full-page desktop visual at `/tmp/eventforge-landing.png` and visually inspected its layout: the dark field-note system, visible investigation trace, warm proof section, and mint closeout all remained distinct and readable.
- Followed the **Open console** navigation to `/console`. The existing operations console rendered with its dashboard headings and controls, confirming the landing page did not replace it.

Reusable pattern: validate the marketing route and the preserved application route separately. For this Vite SPA, `/console` is selected client-side and is covered by the Worker static-assets SPA fallback in production.

## 2026-07-17 — Landing page opened for review

- Started Vite at `http://127.0.0.1:5176` and opened the landing page in the headed `eventforge-landing-live` browser session for live review.
- Confirmed the loaded document title is `EventForge — Autonomy needs a witness`.

## 2026-07-17 — Landing page value and readability refinement

- Reopened `http://127.0.0.1:5176/` in the headed `eventforge-landing-live` browser session after the copy and typography update. Confirmed the document title is `EventForge — One place for every webhook` and the accessibility tree includes the new hierarchy: “One place for every webhook. Less noise.”, “More clarity around the work that matters.”, and “Turn webhook noise into useful work.”
- Captured and visually inspected `/tmp/eventforge-landing-refined.png`. The reduced display scale and sans-serif headings keep the visual character while making the hero, value cards, and supporting copy legible at desktop size.
- Selected **What it solves** and confirmed the in-page navigation resolves to `/#problem`. Reopened `/console` and confirmed the existing operations command center still renders with its dashboard, event feed, approval queue, and Forge Studio controls; returned the live browser to `/` for review.
- Browser console contained only Vite/React development notices, with no application errors.

Reusable pattern: after changing a marketing route, validate the page’s outcome-led headings in the accessibility tree, test at least one in-page anchor, then open the retained application route before returning the browser to the marketing page.
