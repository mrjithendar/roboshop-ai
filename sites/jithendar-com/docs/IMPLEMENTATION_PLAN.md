# Implementation plan — jithendar.com

Adjusted 2026-10-27 after the Phase 1 audit (`SEO_AUDIT.md`). The original plan
assumed an existing Next.js app and a WordPress.com site with content to
migrate. In reality this is a greenfield build. WordPress is already gone, and
nothing on it is worth keeping.

## Decisions

| ID | Decision | Rationale | Source |
|---|---|---|---|
| D-1 | The site lives in `roboshop-ai/sites/jithendar-com/` | Owner choice: one repo. The rest of the monorepo belongs to RoboShop and is off-limits (AGENTS.md). | Owner, 2026-10-27 |
| D-2 | Keep Traefik + cert-manager; no Cloudflare Tunnel | Already running and serving jithendar.com, and needs no DNS change. Cloudflare Access for admin UIs is out of scope unless revisited. | Owner, 2026-10-27 |
| D-3 | Deploy to namespace `jithendar`, Argo app in `argocd/`, AppProject `platform` | The namespace is already allowed in the project. Follows the existing app pattern. | Audit AUD-006 |
| D-4 | Phase 7 becomes "WordPress exit", not a migration | No genuine content existed (AUD-008). | Owner: "I don't need existing data" |
| D-5 | Pre-launch, `/` keeps returning 503 rather than an indexable placeholder | Avoids indexing thin content. The 410 map for spam URLs ships with the first deployment. | AUD-002, AUD-007 |
| D-6 | Static-first rendering (SSG + ISR), `output: 'standalone'` | Smallest runtime footprint on a shared single host, and fits a read-only root filesystem. | Prompt Phase 4/6 |

## Phases (reordered and rescoped)

### Phase 1 — Audit & plan ✅ (this document)

### Phase 1.5 — Owner actions before Phase 2 (no agent code)
- **AUD-003:** confirm `kubectl -n jithendar get certificate,secret` on `mk4`. If the WordPress Certificate is gone, recreate it as a standalone manifest before the current cert expires (2027-01-25; cert-manager renews ~30 days earlier). The agent can draft the manifest on request.
- **AUD-001:** check the other cluster workloads the WordPress pod could reach, and rotate any credentials it could see.
- **AUD-015:** install Node ≥ 24 locally.
- Confirm the publication name `Jithendar.com` and the host provider and spec (AUD-009).

### Phase 2 — Scaffold, content model & SEO foundation
Depends on: Node 24.
- Scaffold Next.js (App Router, TS, Tailwind, ESLint) in this folder, with its own `package.json`. Do **not** join the root `npm test` (avoids coupling with RoboShop CI).
- Zod content schema + `getPublishedContent()` single source of truth; build fails on invalid frontmatter.
- Metadata API, canonicals, non-production `noindex` (`APP_ENV`), `robots.txt`, `/sitemap.xml`, `/news-sitemap.xml`, JSON-LD components.
- `redirects.config.ts` plus a **`gone.config.ts`** that returns 410 for the hijack URLs in AUD-002. Implemented in middleware, because `next.config` redirects cannot return 410.
- Excluded paths: never route `/argocd`, `/grafana` or other shared prefixes. Traefik's longest-prefix match already gives them priority. Add a test that the app does not define them.
- Tests per prompt §2.6 using Vitest (justified as the new dev dependency; the root uses `node --test`, which lacks TS/JSX support without extra tooling).

### Phase 3 — Publication transparency
As in the prompt. Personal and legal facts stay as `TODO(owner)` placeholders.

### Phase 4 — Content platform features
As in the prompt. Lighthouse runs locally against `next start`.

### Phase 5 — n8n + OpenAI drafting
Risk: the largest phase, and it adds n8n + Postgres to a shared host.
- Its own Postgres in `jithendar` (do not reuse RoboShop's `roboshop-ai/postgres`).
- The n8n editor must **not** get a public route until the auth decision is made. Without Cloudflare Access (D-2), use Traefik basic-auth plus an IP allowlist, or `kubectl port-forward` only. Owner decision required at the start of Phase 5.
- Could be split: 5a schema + discovery, 5b drafting + PR creation.

### Phase 6 — Infrastructure, CI/CD & GitOps
- Kustomize `base/staging/production` under `sites/jithendar-com/deploy/`. The Argo `Application` in `argocd/jithendar-com.yaml` is added to `argocd/kustomization.yaml` (shared file, called out in the report).
- **Launch gate (A3.5):** the production overlay's Ingress is added in a separate, reviewed change after smoke tests pass against an in-cluster Service.
- TLS: own the `jithendar-com` Certificate (resolves AUD-003 permanently) and keep it compatible with `minikube/shared-tls`.
- CI: new `ci-jithendar-com.yml`. Reuse `publish-ecr.yml` only if it can be extended without changing RoboShop behavior; otherwise a dedicated workflow. Digest pinning, SHA-pinned actions, arm64 build (AUD-010/011/012).
- NetworkPolicy + kindnet enforcement test (AUD-013); secrets approach (AUD-014).
- Single-host limitation documented in `docs/OPERATIONS.md`.

### Phase 7 — WordPress exit (rescoped)
- Delete `minikube/wordpress/` and `minikube/test-wordpress.py`, and update the `minikube/shared-tls` messages that tell users to install WordPress (AUD-005). **Requires owner approval** and AUD-003 resolved first.
- Verify the 410 map in production. Search Console removals checklist.
- WXR importer: **dropped** unless the owner produces an older WordPress.com export with real posts.

### Phase 8 — Monetization scaffolding, observability, final validation
As in the prompt. Reuse the existing Prometheus/Grafana/Loki/OTel collector. Acceptance test 9 ("migrated WordPress URLs redirect") becomes "hijack URLs return 410".

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The shared jithendar.com cert stops renewing after the WordPress removal | High | Phase 1.5 check, Phase 6 ownership |
| A new public workload is exposed before it is ready (repeat of AUD-001) | High | A3.5 launch gate; n8n gets no public route by default |
| The shared single host runs out of resources (RoboShop + observability + site + n8n + Postgres) | Medium | Requests/limits per pod, static-first site, Phase 6 capacity note; owner to confirm host spec |
| Monorepo CI coupling: site changes trigger RoboShop jobs or the reverse | Medium | Path-filtered workflows; site keeps its own `package.json` |
| Google Drive sync conflicts with `node_modules` and `.next` | Low | AUD-016 |
