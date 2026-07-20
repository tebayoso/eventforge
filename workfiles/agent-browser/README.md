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
- Changed verified webhook processing to start workflow analysis in the background and acknowledge it immediately. Redelivered the same GitHub delivery: GitHub recorded HTTP `202`, and EventForge completed fresh process-retained thread `019f71cf-98c8-7213-ace1-ed7d293e90a1` with an assessment and an empty action queue.
- Opened that thread in the Codex desktop app. The review identified the event as a test-only request and retained the read-only policy.

Reusable pattern: after opening a test issue, confirm the GitHub delivery is `202` before waiting for `/runs` to become `completed`; then assert `/actions` is an empty array. A slow agent must never delay the provider acknowledgment.

## 2026-07-18 — Forge artifact safety-review flow

- Started the deterministic local control plane with `EVENTFORGE_DEMO_MODE=true pnpm --filter @eventforge/control-plane start` and the console with `pnpm dev:console -- --host 127.0.0.1`.
- Opened `http://localhost:5173/console` in the `eventforge-forge` agent-browser session, selected **Forge draft**, and confirmed the validation notice appeared.
- Selected **Review artifact**. Outcome: the accessible dialog exposed requested scopes, scanner status, every generated file as keyboard-accessible tabs, and a read-only source pane before showing **Approve artifact**.
- Approved the validated demo artifact. Outcome: the dialog closed and the console confirmed that installation remains a separate local action; no generated connector was executed or hot-loaded.
- Captured the review state at `/tmp/eventforge-forge-review.png`.

Reusable pattern: exercise Forge Studio by creating a draft, opening **Review artifact**, checking the source tabs and scanner report, then approve only a validated demo artifact. Approval must not install or execute generated code.

## 2026-07-18 — Public landing submission CTA

- Opened `http://localhost:5173/` in the `eventforge-landing` agent-browser session.
- Verified the hero exposes **Watch the demo** and that it targets `https://youtu.be/pht3rrl--pE`; the console CTA remains routed to `/console`.

Reusable pattern: keep the demo CTA on the public landing page and verify its exact target without navigating away from the local application.

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

## 2026-07-18 — Production-hardening acceptance flow

- Started the credential-free control plane on `http://127.0.0.1:4310` and Vite console on `http://localhost:5173/console`; used the `eventforge-quality` agent-browser session.
- Confirmed the exact-origin CORS boundary: `http://127.0.0.1:5173/console` reported offline while the configured `http://localhost:5173` origin reported online. Browser console inspection contained no application errors.
- Switched light and dark themes. Outcome: both `document.documentElement.dataset.theme` and `localStorage.eventforge-theme` updated, with no CSP error. Repeated the console snapshot at a 390×844 viewport and found no missing primary workflow controls.
- Ran the GitHub CI demo, opened two proposals produced by the normal run plus an MCP-started analysis, rejected one and approved the other. Outcome: both linked agent runs moved from `waiting_for_approval` to `completed`; the approved run stated that execution still requires a dedicated policy-controlled worker.
- Created a Forge draft from “Create a GitHub read-only connector for deployment status events.” Outcome: requested scopes were exactly `events:read` and `github:read`; `provider:write` was absent. Opened the keyboard-accessible file tabs, closed the dialog with Escape, then approved the reviewed draft. No install or execution occurred.
- Stopped the control plane while leaving the console open. Outcome: status changed to **Control plane degraded**, cached data remained visible, and each affected panel said its refresh failed. Restarting the control plane returned the status to online without reloading the browser.
- Sent an invalid GitHub delivery with `x-eventforge-demo: true` directly to `/webhooks/github`. Outcome: HTTP `401`; demo mode cannot bypass provider signatures. Ran the normal `/events/demo` flow afterward and confirmed the approval proposal still appeared.
- Evidence is stored under `workfiles/agent-browser/screenshots/`: `quality-console-initial.png`, `quality-console-dark.png`, `quality-console-mobile.png`, `quality-console-decisions.png`, `quality-forge-approved.png`, `quality-console-degraded.png`, and `quality-console-final.png`.

Reusable pattern: keep the exact configured browser origin, verify mutation outcomes in both the affected resource and the audit/run timeline, test cached degraded state by stopping only the API, and treat public webhook routes as signed-only even when demo mode is enabled.

## 2026-07-18 — eventforge.dev production landing deployment

- Deployed the console static-assets Worker to the `eventforge.dev` custom domain as Cloudflare version `859e9d5f-5b27-4113-a124-51534cef0821`.
- Verified Cloudflare public DNS returned both IPv4 and IPv6 records. The local macOS resolver retained its pre-deploy negative answer, so the `eventforge-release-resolved` agent-browser session used a temporary Chromium host resolver rule for the already-published Cloudflare address; no application or DNS configuration was changed for this workaround.
- Opened `https://eventforge.dev/` and confirmed the production title, primary navigation, “One place for every webhook. Less noise.” hero, console CTA, and exact demo target `https://youtu.be/pht3rrl--pE`.
- Followed **See your event inbox** and confirmed the final URL was `https://eventforge.dev/console`. The console rendered its event feed, connector health, approval queue, run log, Forge Studio, and audit controls while truthfully reporting **Control plane offline** because this release deploys only the static shell.
- Browser error inspection and filtered console output were empty. Direct HTTPS checks returned `200` for `/` and the `/console` SPA fallback with CSP, permissions policy, referrer policy, anti-framing, and MIME-sniffing headers.
- Evidence is stored at `workfiles/agent-browser/screenshots/eventforge-dev-live.png` and `workfiles/agent-browser/screenshots/eventforge-dev-console.png`.

Reusable pattern: after a new custom-domain attachment, distinguish public DNS propagation from a developer machine's negative DNS cache. Verify authoritative/public resolvers and HTTPS independently, then use a temporary browser resolver override only for local acceptance testing; never commit that override or treat it as production configuration.

## 2026-07-18 — GitHub pull request to local Codex review

- Started `pnpm dev:github` with the local named tunnel `eventforge-local`. EventForge verified `https://eventforge-hooks.planeflare.com/health`, then patched GitHub webhook `#653895042` to the signed `/webhooks/github` endpoint with `pull_request`, `pull_request_review`, and `issue_comment` subscriptions alongside the existing issue and check-run events.
- Pushed commit `40ac4c7` to PR [#3](https://github.com/tebayoso/eventforge/pull/3). GitHub delivery `3831934487258726400` sent `pull_request:synchronize` and received HTTP `202` in 0.69 seconds.
- Confirmed local event `1edbf54f-d29e-43ea-a8f9-e6bc0aae0a38` recorded `signatureStatus: verified`, repository `tebayoso/eventforge`, PR `#3`, and the exact pushed SHA.
- Waited for the background read-only review. Outcome: run `1f374ffc-62e6-41ee-90f3-ea81f93335a3` completed in Codex thread `019f758c-2523-71d3-9b19-a8a89ddaae4d`; `/actions` remained empty. Opened the resulting task in the Codex desktop app.

Reusable pattern: keep `pnpm dev:github` running, require public health plus an active matching GitHub hook before pushing, assert the provider delivery returns `202`, then correlate the delivery GUID to a verified local event and wait independently for the run's `threadId`. A PR review must remain read-only and leave `/actions` empty.

## 2026-07-20 — Production console deployment and backend readiness check

- Deployed the current static console with `VITE_EVENTFORGE_API_URL=https://api.eventforge.dev` to the `eventforge.dev` Worker custom domain as Cloudflare version `9ec9b09c-68ae-4e86-9052-12efb15126de`.
- Opened `https://eventforge.dev/` in the `eventforge-e2e` agent-browser session. The production title, navigation, hero, console CTA, and demo link rendered successfully; browser console and error inspection were empty.
- Followed **Open console** to `https://eventforge.dev/console`. The SPA fallback rendered the operations console, themes, refresh control, demo controls, event feed, connector health, approvals, run log, Forge Studio, and audit panel.
- The console truthfully reported **Control plane offline**. Independent resolution checks confirmed `api.eventforge.dev` has no DNS record, and Cloudflare inventory confirmed the existing `eventforge-local` tunnel has no active connectors.
- Did not create API or hook DNS records: Cloudflare documents that DNS pointing to an inactive tunnel produces error 1016, and the repository's remote entry point still rejects startup without a real authenticator while operational repositories remain process-local.
- Evidence is stored at `workfiles/agent-browser/screenshots/eventforge-production-2026-07-20.png` and `workfiles/agent-browser/screenshots/eventforge-production-console-2026-07-20.png`.

Reusable pattern: deploy the console with its intended API origin, verify the landing and SPA routes independently, then treat an offline console as a backend readiness failure. Never make production DNS resolve by pointing it at a tunnel with no connectors or by bypassing EventForge's remote-mode safety gates.

## 2026-07-20 — Cloudflare-native preview foundation acceptance

- Opened `https://eventforge.dev/` at desktop and 390×844 mobile viewports. The production title, navigation, webhook-focused hero, value sections, and console links rendered; browser console and error inspection were empty.
- Opened `https://eventforge.dev/console` at 1440×900. The operations shell rendered all primary controls and truthfully remained **Control plane offline** because the authenticated API is still gated.
- Opened `https://eventforge-cloud-preview.jorge-b9f.workers.dev/health`. Outcome: HTTP-rendered JSON reported `environment: preview` and `ingress: gated` after the acceptance canary.
- Opened `/v1/events` without an identity. Outcome: structured `503 AUTH_GATED`; no unauthenticated API surface was exposed while Better Auth and tenant repositories remain incomplete.
- Before the browser pass, a disposable signed canary returned `202`, produced one encrypted R2 payload reference, one D1 event/outbox/audit chain, and reached `processed` through the Queue consumer. The Worker was redeployed with ingress disabled immediately afterward.
- Evidence is stored at `workfiles/agent-browser/screenshots/cloudflare-foundation-desktop.png`, `cloudflare-foundation-mobile.png`, `cloudflare-console-desktop.png`, `cloudflare-preview-health-mobile.png`, and `cloudflare-auth-gate.png`.

Reusable pattern: keep hosted preview ingress disabled by default, temporarily enable only a disposable signed canary after secret rotation, reconcile R2, D1, outbox, audit, and Queue state, then redeploy the gate and independently verify it through both the health endpoint and an unauthenticated API request.

## 2026-07-20 — Production console authentication audit

- Opened `https://eventforge.dev/console` in a clean `eventforge-auth-audit` browser session. Outcome: the static operations shell returned `200` and rendered without any login, redirect, session cookie, or authentication challenge.
- Network inspection showed the shell immediately attempted unauthenticated requests to `https://api.eventforge.dev/events`, `/actions`, `/runs`, `/audit`, `/memory`, `/connectors`, and `/forge`.
- DNS inspection found no records for `api.eventforge.dev` or `hooks.eventforge.dev`. The only hosted backend deployment remains the isolated `eventforge-cloud-preview` Worker; its unauthenticated `/v1/events` endpoint returned structured `503 AUTH_GATED`.
- Conclusion: the static console deployment completed, but the authenticated hosted product deployment did not. `/console` must not be represented as production-ready until Better Auth, session-aware route protection, tenant repositories, and the production API custom domain are deployed and pass an unauthenticated redirect/denial test.

Reusable pattern: test protected application shells in a clean browser context, verify both the document response and downstream API calls, and require an explicit login redirect or denial before calling the frontend deployment complete.

## 2026-07-20 — Production custom-domain remediation

- Provisioned isolated production D1 control/event databases, private R2 payload storage, ingestion Queue, and DLQ; applied both initial migrations and installed production-only payload and canary secrets.
- Deployed `eventforge-cloud-production` version `33e20d69-fa9b-4f09-8f4f-8c3d87641405` to Worker custom domains `api.eventforge.dev` and `hooks.eventforge.dev`. Cloudflare created their DNS and TLS without a Tunnel.
- Verified both hostnames through Cloudflare, Google, and Quad9 public resolvers. TLS verification succeeded; production health reports `ingress: gated`. The API host returns `503 AUTH_GATED` for `/v1/events` and does not expose webhook routes; the hook host returns `404` for API routes and `503 INGRESS_GATED` for unsigned canary ingress.
- Deployed `eventforge-console` version `5221b330-28be-4ba3-af3f-33b0bed4ca0a`. A Worker-first route now intercepts `/console` and returns a non-cacheable `503` authentication gate instead of the operations SPA.
- A clean browser confirmed the new console gate and `hooks.eventforge.dev` production health. The local macOS/Chromium resolver still held the earlier negative answer for `api.eventforge.dev`; public DNS, an explicit-address TLS request, and a temporary Chromium host-resolver rule all reached the new API Worker successfully. The resolver override was used only for acceptance and was not saved to production configuration.
- Evidence is stored at `workfiles/agent-browser/screenshots/production-console-auth-gate.png`, `production-api-health.png`, and `production-hooks-health.png`.

Reusable pattern: attach originless Worker custom domains through Wrangler, verify at three public resolvers plus TLS, isolate API and hook routes by hostname, and treat a local negative-DNS cache separately from authoritative deployment state.

## 2026-07-20 — Fresh-clone local acceptance

- Cloned `origin/main` at `a741795` into an empty temporary directory, copied only `.env.example`, installed with the frozen lockfile, and passed the complete `pnpm quality` release gate.
- Started the default credential-free control plane and console from that clone. Opened `http://localhost:5173/`, followed **Open console**, and confirmed the console initially reported **Control plane online** with no browser errors.
- Ran **Run GitHub CI demo**, opened the pending remediation proposal, and selected **Approve action**. Outcome: the run completed and the console confirmed the decision was recorded without executing a write.
- Created and reviewed a Forge Studio draft, inspected the generated artifact dialog, and approved it. Outcome: the console explicitly kept installation as a separate action; no connector was executed or hot-loaded.
- Reloaded `/console` under an iPhone 14 viewport. The API remained alive, but the console became offline because the seven-resource polling cycle and normal interactions exhausted the shared 120-request/minute limiter. Raised only the loopback-local default to 600 requests/minute and retained the 120-request remote default; added a regression test for this boundary.
- Repeated the mobile reload after the fix, sent 160 additional loopback requests inside one minute, and waited through another polling cycle. All 160 requests returned `200` and the console remained **Control plane online**.
- Browser console output contained only Vite/React development notices. Evidence is stored at `workfiles/agent-browser/screenshots/fresh-installer-mobile.png`.

Reusable pattern: validate installation from an empty remote clone, not an existing working tree; exercise enough polling and mutations to cross at least one refresh boundary; and distinguish a live API from a UI that has entered a rate-limited degraded state.

## 2026-07-20 — Product landing and pricing expansion

- Started the Vite console at `http://127.0.0.1:5173/` and opened the public landing page in the `eventforge-landing` agent-browser session.
- Verified the desktop accessibility tree includes the operational-control-plane hero, Product, Pricing, Docs, GitHub, and console navigation, plus the live GitHub star/fork badge.
- Verified the page now presents verified ingress, operational context, replay, bounded reactions, equal API/CLI/MCP/OpenTelemetry/Console surfaces, the gateway/operations/reactions roadmap, Free/Team/Pro/Business pricing, and the passwordless Codex install command.
- Captured and visually inspected desktop, full-page, and iPhone 14 renders at `workfiles/agent-browser/screenshots/eventforge-landing-product-desktop.png`, `eventforge-landing-product-full.png`, and `eventforge-landing-product-mobile.png`.
- Browser error inspection was empty. The GitHub stats request gracefully falls back to zero when the public API is unavailable.

Reusable pattern: for marketing changes, validate both the accessibility hierarchy and a full-page visual at desktop and mobile widths; external proof badges must have a deterministic fallback and documentation links must target a real public URL.

## 2026-07-20 — Expanded landing page production deployment

- Deployed the updated static console Worker to `https://eventforge.dev/` as Cloudflare version `9548169c-93a0-4a78-a0e5-55d86949b9ce`.
- Reopened the production landing page at desktop width and verified the new hero, Product, Pricing, Docs, GitHub, roadmap, four pricing tiers, Codex install panel, and final console CTA in the accessibility tree.
- Confirmed the live GitHub API badge resolves to `0 stars` and `0 forks` for `tebayoso/eventforge`; when the public GitHub API is unavailable the UI shows an em dash instead of inventing a count.
- Verified the production CSP includes `https://api.github.com`, so the live star/fork request is allowed. Browser error inspection was empty.
- Screenshot captured at `workfiles/agent-browser/screenshots/eventforge-production-landing-new.png`.

Reusable pattern: when adding a third-party proof badge, update both the HTML CSP and the deployed Worker `_headers`; test the live response headers and the browser request, not only the local Vite page.

## 2026-07-20 — Enterprise pricing follow-up

- Added the Enterprise contracted-band tier and transparent Team/Pro overage notes to the pricing section.
- Deployed the follow-up static Worker as Cloudflare version `e9df48a2-0095-48bc-8d06-b7e6fda207fc`.
- Opened `https://eventforge.dev/?release=33330e0` to bypass the browser's prior asset cache and verified Free, Team, Pro, Business, and Enterprise headings, live GitHub stars, and no browser errors.
- Screenshot captured at `workfiles/agent-browser/screenshots/eventforge-production-landing-enterprise.png`.

## 2026-07-20 — IsItAgentReady production audit

- Opened `https://isitagentready.com/`, entered `https://eventforge.dev/`, and ran the public Cloudflare agent-readiness scan.
- Final result: **Level 5 — Agent-Native**. Passing checks include robots.txt and AI rules, sitemap, Link headers, Markdown negotiation, Content Signals, API Catalog, OAuth/OIDC discovery, OAuth Protected Resource metadata, Auth.md registration metadata, MCP Server Card, A2A Agent Card, Agent Skills index, and WebMCP.
- The only failing enabled check is DNS-AID. The authoritative zone has no `_index._agents.eventforge.dev`, `_mcp._agents.eventforge.dev`, or `_a2a._agents.eventforge.dev` SVCB/HTTPS/TXT entrypoint records. This requires Cloudflare DNS write access; the current Wrangler identity exposes zone read but not DNS edit permission.
- Independent production checks confirmed `https://eventforge.dev/` returns Markdown when requested with `Accept: text/markdown`, publishes the machine-readable discovery documents, and includes agent-useful Link headers. `https://eventforge.dev/console` remains a deliberate `503` sign-in gate.
- Browser error inspection was empty. Final score evidence is captured at `workfiles/agent-browser/screenshots/eventforge-agent-ready-final.png`.

Reusable pattern: run the evaluator after deployment, inspect its JSON evidence rather than relying on the headline score, fix HTTP discovery contracts in the Worker, and treat DNS-AID as a separate authoritative-zone change that cannot be completed with a zone-read-only token.
