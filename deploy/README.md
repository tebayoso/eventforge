# Deployment

## Private edge status (issue #9)

Private edge is **blocked, not available**. The versioned Helm reference (`0.2.0`) deliberately refuses `privateEdge.enabled=true`; it is a security reference and preflight surface, not an installable claim. The only declared reference shape is Kubernetes v1.33, one `nginx` ingress class, cert-manager TLS, namespace-scoped service account, restricted pods, default-deny NetworkPolicy, and externally managed Postgres/object store/queue/OIDC/KMS. NetworkPolicy enforcement is mandatory; manifests alone do not enforce it. The policy is opt-in until preflight can safely validate required DNS/dependency egress. Kubernetes documents the [restricted pod profile](https://kubernetes.io/docs/concepts/security/pod-security-standards/) and requires a network plugin that enforces [NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/). No managed vendor/version, capacity envelope, or private-edge drill is claimed as exercised.

Run `pnpm private-edge:preflight`; it exits non-zero and emits human and JSON results without secrets. `--cluster` additionally reports the kubectl server version, but cannot convert fixture or endpoint checks into readiness. Mandatory blockers are Worker D1, R2, Queues, cron, and hosted identity/OIDC workspace-MFA parity. No Durable Object or KV binding is used by application code (generated Worker types are not a runtime dependency).

Keys must be customer-owned external KMS or Secrets Store CSI references only; the chart contains no key material. Missing/revoked keys must fail dependent operations closed. Before availability, bootstrap, rotation with safe dual-read only, revocation, lost-key terminal behavior, break-glass ownership, and isolated restore/promotion must be exercised. Backups must cover configuration/mapping, durable events/attempts, evidence and metadata, pseudonymous audit, and policy/approval; RPO 15 minutes and RTO 4 hours remain inherited targets, not proven outcomes. Rollback is compatible code/config only: never database rewind or evidence deletion, and blocked across incompatible schema.

Private-edge diagnostics are unimplemented. A future export must require role plus recent MFA, exact preview, allowlisted bounded fields, encryption, audit, and exclusion of secrets, environment, tokens, payloads, evidence, raw logs, key paths, and tenant identifiers. Customer owns cluster/network/storage/KMS/identity/backup destination; EventForge owns chart/app/migrations/preflight/compatibility; incident diagnosis is joint. No airgap, hosted fallback, telemetry requirement, bespoke topology, or unmanaged fork is supported.

## Production architecture

EventForge is the product name; `eventforge.dev` is its canonical public domain. This deployment deliberately does not rename packages, containers, Helm releases, or runtime variables.

```text
Browser -> https://eventforge.dev -> Cloudflare Worker Static Assets (Vite console)
                                       |
                                       | credentialed CORS
                                       v
Browser -> https://api.eventforge.dev -> Cloudflare Access -> named Cloudflare Tunnel -> control-plane Service
Provider -> https://hooks.eventforge.dev -> signed webhook verification --------------------------^
```

The Vite console is deployed as a static-assets Worker because it has no server-side runtime needs. The control plane remains a Node/Fastify service: it uses the Codex SDK, Postgres, and process APIs, so moving it to Workers would be an unsupported runtime change. A remotely managed, named Cloudflare Tunnel publishes the `api` and `hooks` hostnames without opening an origin ingress port. The existing `trycloudflare.com` Quick Tunnel is local-development-only.

The diagram is the target Track B architecture, not a currently supported production deployment. The control plane now refuses remote startup without injected MFA authentication, PostgreSQL, encryption, and explicit origins; the repository does not yet ship that identity-provider integration. Do not expose local mode through Cloudflare Access or Tunnel as a substitute.

When Track B is enabled, `api.eventforge.dev` must be protected with application authentication and may additionally use Cloudflare Access. CORS is an additional browser control, not authentication. Keep `hooks.eventforge.dev` public only for provider webhook paths; its signature verification remains enforced by EventForge. Do not point a provider webhook at `api.eventforge.dev`.

## Externally supplied values

Keep all secret values in the deployment platform's secret store, Kubernetes Secret, or ignored `.env`; do not put them in Wrangler configuration, Helm values, Git, or browser `VITE_*` variables.

| Value                                                                                                      | Where it is supplied                                                 | Purpose                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                                                                                     | CI or deploy shell                                                   | Least-privilege token used by Wrangler to publish the console.                                                                          |
| `CLOUDFLARE_ACCOUNT_ID`                                                                                    | CI or deploy shell                                                   | Cloudflare account selection for Wrangler when the token can access more than one account.                                              |
| `CLOUDFLARE_TUNNEL_TOKEN`                                                                                  | Ignored Compose `.env` or Kubernetes `eventforge-cloudflared` Secret | Token for the remotely managed production Tunnel; never pass it as a command argument.                                                  |
| `VITE_EVENTFORGE_API_URL`                                                                                  | Console build environment                                            | Public API base URL. Production value: `https://api.eventforge.dev`. It is compiled into browser assets and is not a secret.            |
| `EVENTFORGE_ALLOWED_ORIGINS`                                                                               | Control-plane environment                                            | Comma-separated browser allowlist. Production value: `https://eventforge.dev`. The control plane refuses an empty production allowlist. |
| `DATABASE_URL`                                                                                             | Existing `eventforge-postgres` Secret                                | Postgres/pgvector connection string.                                                                                                    |
| `OPENAI_API_KEY`                                                                                           | Existing `eventforge-runtime` Secret                                 | Required for Codex-backed runs.                                                                                                         |
| `EVENTFORGE_ENCRYPTION_KEY`                                                                                | Existing `eventforge-runtime` Secret                                 | At least 32 random bytes; generate and rotate outside source control.                                                                   |
| `GITHUB_WEBHOOK_SECRET`, `LINEAR_WEBHOOK_SECRET`, `SENTRY_WEBHOOK_SECRET`                                  | Existing `eventforge-runtime` Secret                                 | Required for live webhook signature verification.                                                                                       |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `SENTRY_AUTH_TOKEN` | Existing `eventforge-runtime` Secret                                 | Reserved for Track B provider-account integrations; not consumed by the local release.                                                  |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                               | Existing `eventforge-runtime` Secret or environment                  | Reserved for Track B immutable artifact storage; not consumed by the local release.                                                     |

## Track B Cloudflare preflight — reference only

Do not run the deploy commands until all of the following are verified by the domain/account owner:

1. `eventforge.dev` is registered and its active DNS zone is in the intended Cloudflare account. This task did not register or transfer it.
2. The deployer has the intended Cloudflare account, zone access, and a scoped API token. For the console, grant the Workers script/route permissions and zone read access required by Wrangler; grant DNS write only to the identity that will create Tunnel routes. Prefer separate CI deploy and infrastructure-admin tokens.
3. No existing apex `CNAME` conflicts with the Worker custom domain. The configured custom domain is `eventforge.dev`; Wrangler will create and manage its DNS/certificate attachment when the zone is available.
4. Create a remotely managed tunnel named `eventforge-production`. Store its token only as `CLOUDFLARE_TUNNEL_TOKEN` / the `eventforge-cloudflared` Kubernetes Secret. The `cloudflared` workload sends the token through `TUNNEL_TOKEN`, so it is not exposed in process arguments.
5. Add the tunnel's published applications: `api.eventforge.dev -> http://eventforge-eventforge:4310` (replace the service name with the rendered release name) and `hooks.eventforge.dev ->` the same service. Include the final `http_status:404` catch-all when configuring ingress through the API.
6. Create Cloudflare Access applications before publishing traffic: require the approved identity policy for `eventforge.dev` and `api.eventforge.dev`; leave only `hooks.eventforge.dev` outside Access for signed provider deliveries. Apply WAF/rate-limit rules to the public webhook hostname.
7. Use an apex policy: attach the console Worker only to `eventforge.dev`. For `www.eventforge.dev`, create a proxied placeholder DNS record (`A 192.0.2.0` or `AAAA 100::`) and a permanent Cloudflare Redirect Rule to `https://eventforge.dev/$1`. This avoids a second console origin and keeps the CORS allowlist canonical.

Cloudflare's current documentation covers [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [remotely managed Tunnels](https://developers.cloudflare.com/tunnel/setup/), and [Kubernetes tunnel health/replica guidance](https://developers.cloudflare.com/tunnel/deployment-guides/kubernetes/).

## Deploy the console shell

`apps/console/wrangler.jsonc` is the source of truth for the static Worker, SPA fallback, `eventforge.dev` custom domain, and disabled `workers.dev` hostname. Its security headers are in `apps/console/public/_headers`.

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
export VITE_EVENTFORGE_API_URL='https://api.eventforge.dev'
pnpm install --frozen-lockfile
pnpm --filter @eventforge/console deploy:cloudflare
```

For a local Worker-assets preview, use `pnpm --filter @eventforge/console preview:cloudflare`. It uses the local console API URL unless `VITE_EVENTFORGE_API_URL` is set for the build.

Until Track B remote authentication is enabled, publishing these static assets produces only the landing page and an offline operations shell. It is not a functioning remote EventForge deployment.

## Deploy the control plane and named Tunnel

### Docker Compose

For local infrastructure validation, create the ignored `.env` from `.env.example` and start PostgreSQL plus MinIO without a public tunnel:

```bash
docker compose up -d
```

The `app` and `cloudflare-tunnel` profiles are deployment artifacts for the future remote release. Do not enable them until the status document marks remote authentication and durable repositories supported. The control-plane image can still be built and inspected with `docker compose --profile app build control-plane`. `cloudflared` has no published host port; when eventually enabled, it only needs outbound access to Cloudflare.

### Kubernetes / Helm — Track B reference

The chart is render/lint tested but is not a production release while remote mode is disabled. It keeps the control plane at one replica because workflow, run, approval, and memory projections are currently process-local. It is not safe to raise `replicaCount` until shared repository wiring and restart hydration are complete.

```bash
kubectl create secret generic eventforge-postgres \
  --from-literal=database-url='postgres://…'
kubectl create secret generic eventforge-runtime \
  --from-literal=openai-api-key="$OPENAI_API_KEY" \
  --from-literal=encryption-key="$(openssl rand -base64 48)" \
  --from-literal=github-webhook-secret="$GITHUB_WEBHOOK_SECRET"
kubectl create secret generic eventforge-cloudflared \
  --from-literal=tunnel-token="$CLOUDFLARE_TUNNEL_TOKEN"
helm upgrade --install eventforge ./deploy/helm/eventforge \
  --set-string image.digest='sha256:PUBLISHED_CONTROL_PLANE_DIGEST' \
  --set cloudflareTunnel.enabled=true \
  --set providerSecrets.github.webhookEnabled=true \
  --set-string env.EVENTFORGE_ALLOWED_ORIGINS='https://eventforge.dev'
```

Add the other provider and storage values from the table to the runtime secret before enabling those integrations. Set only the matching `providerSecrets.<provider>.<credential>Enabled=true` flag after its secret exists; webhook verification does not require unrelated OAuth credentials. The chart probes the control plane at `/health` and each `cloudflared` connector at `/ready`.

## Track B acceptance checklist

1. Confirm the Tunnel shows two healthy connectors in Cloudflare and `kubectl get pods` shows the control plane Ready plus both `cloudflared` pods Ready.
2. From an approved Access session, verify `https://api.eventforge.dev/health` returns `200` and reports `eventforge-control-plane`. Verify an unauthenticated request to an application API path is challenged by Access.
3. Open `https://eventforge.dev`, verify the browser uses `https://api.eventforge.dev`, and check that an origin other than `https://eventforge.dev` receives no CORS allow header.
4. Configure each provider webhook at `https://hooks.eventforge.dev/webhooks/<provider>` with its matching signing secret. Send a signed test delivery and verify EventForge returns `202`, stores a `verified` event, and creates no automatic write.
5. Verify `https://www.eventforge.dev/...` returns a single permanent redirect to the apex, then re-run the console/API checks.
