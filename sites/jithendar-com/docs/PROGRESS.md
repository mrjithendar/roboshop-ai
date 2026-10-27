# Progress log — jithendar.com

## Phases 3 + 4 — Transparency pages and content platform (2026-10-27, owner request: "implement complete website")

**Status:** complete locally. Not yet pushed; CI deploys on push. Phase 5 (n8n/OpenAI) and Phase 8 (monetisation scaffolding, observability) are not website features and were not started. Phase 7 (WordPress migration) is unnecessary; see AUD-008.

**Phase 3, transparency**
- `content/pages/`: about, contact, editorial-policy, corrections-policy, ai-use-policy, privacy-policy, terms. Rendered by `src/app/[page]`, editable as MDX, with `updatedAt` shown.
- Policies describe only the workflow that exists in this repo. Unverifiable facts (bio, contact email, legal entity, jurisdiction, log retention, licences, sponsorship rules, AI providers) are `<Todo>` blocks: visible in dev/preview, **render nothing in production**.
- Author profile: verified GitHub link (`github.com/mrjithendar`, name matches), bio TODO. "Open-source" wording avoided because the RoboShop AI repo has no licence.
- Article page: distinct badges for News / Analysis / Tutorial / Opinion / Curated summary / Project / Sponsored; byline → author page; published, updated, reading time; category link; sources; corrections log (links to the policy); curated and sponsored disclosures; tags.
- `docs/GOOGLE_NEWS_READINESS.md`.

**Phase 4, platform features**
- Category (`/category/<c>`), tag (`/tag/<t>`), collection and author listings with `/page/<n>` pagination (`/page/1` → 308 to base, out of range → 404). Taxonomy pages with < 3 items or no intro are `noindex, follow` and kept out of the sitemap; tag pages are always noindex. Category intros live in `src/config/taxonomy.ts`.
- Related reading: explicit `related` frontmatter first, then category (3) / related-category pair (1) / shared tag (2) scoring, deterministic tie-break, published only.
- Reading time; "On this page" TOC from h2/h3 (ids by rehype-slug, collected in the same compile); Shiki highlighting at render time (light/dark); copy button with an `aria-live` announcement.
- Search: `/search-index.json` (published only), lazy-loaded client search at `/search` (noindex).
- RSS 2.0: `/feed.xml` and `/category/<c>/feed.xml`, autodiscovery link in `<head>`.
- Broken-internal-link check (`src/lib/content/links.ts`), run by `npm test` against real content, so CI fails on a broken link.
- `npm run preview` (`CONTENT_PREVIEW=true`) shows `review` items locally with a badge; forced off when `APP_ENV=production` (tested).
- Site icon; redesigned header, footer (topics, policies, RSS) and homepage (news, articles, projects, topics, empty state).
- Two drafts for owner review, `status: review` (not public): `projects/roboshop-ai` (facts from the repo README only) and `blog/deploy-nextjs-kubernetes-argo-cd` (from this repo's real manifests and workflow).

**New dependencies:** `shiki` + `@shikijs/rehype` (build-time highlighting, no client JS), `rehype-slug` (heading ids), `hast-util-to-string` + `unist-util-visit` (TOC plugin; already transitive deps of MDX), `@types/hast`.

**Fixed along the way:** inline code was dark-on-dark in dark mode (typography plugin `lab()` fallback), now an explicit pill style; `/favicon.ico` 404 console error, now fixed with an icon; a `setState`-in-effect lint error in search, removed by dropping the `?q=` prefill.

**Commands run → result** (Node 26.8.2)
| Command | Result |
|---|---|
| `npm run lint` | Pass. 0 problems |
| `npm run typecheck` | Pass |
| `npm test` | Pass. 11 files, 88 tests |
| `APP_ENV=production npm run build` | Pass. No warnings |
| `kubectl kustomize deploy/production` | Pass |
| `shellcheck scripts/*.sh` | Pass |
| Production server + curl, fixture content | Pass. Status, single `<h1>`, canonical and robots correct on 19 routes; feeds valid; search index and sitemap published-only |
| Production server + curl, real content | Pass. 7 pages 200 and indexable; 0 `TODO(owner)` in HTML; review drafts 404 |
| Lighthouse 12.8.2, local `http://` | Home mobile 96/100/79/100 (perf/a11y/bp/seo), desktop 100/100/–/100; about mobile 96/100; blog 96–100 perf, a11y 100 (SEO 66 because the empty listing is noindex by design); article (staging preview) mobile 95, desktop 100, a11y 100 (SEO 66 because staging is noindex). Best-practices deductions are only HTTPS/HTTP2 audits from serving locally over http. Mobile LCP 2.7–2.9 s includes ~1.1 s of a local HTTPS-upgrade fallback; on HTTPS it would be about 1.6–1.8 s (estimate, not measured). These are lab scores, not field data |

**Open:** owner TODOs (see `GOOGLE_NEWS_READINESS.md`); AUD-018 (client-rendered 404 body on dynamic routes); no published content yet.

## Deployment to mk4 over HTTPS (2026-10-27, owner request; ahead of the Phase 6 plan)

**Status:** manifests, Dockerfile, CI and Argo app written and validated; ECR repo created. **Waiting on the owner to commit and push.**

**Update (owner request: "CI should build and deploy"):** CI now deploys end to end without cluster credentials. `publish` commits the image digest to `deploy/production`, Argo CD auto-syncs `jithendar-com` (no prune, no self-heal; allow-listed exception in `scripts/argocd/validate.py`), and `deploy` waits for `/api/health` to report the commit, then runs `scripts/smoke.sh`. This replaces the earlier one-off `kubectl apply` plan; the only manual cluster step is creating the Argo Application once. Checks: actionlint + shellcheck clean; `validate.py` 26 apps OK; catalog tests 11 passed; Argo app and digest-pinned overlay pass server dry run; site tests 67 passed.

**Changes**
- `src/app/api/health/route.ts` + test: probe endpoint.
- `Dockerfile`, `.dockerignore`: multi-stage, `node:26-alpine`, non-root UID 1000, standalone output.
- `deploy/base/*`, `deploy/production/*`: see `docs/DEPLOYMENT.md`.
- Outside the site folder (shared files): `argocd/jithendar-com.yaml`, an entry in `argocd/kustomization.yaml`, `.github/workflows/ci-jithendar-com.yml`.
- AWS: created ECR repository `jithendar-com` (immutable tags, scan on push, lifecycle keeps 30).

**Commands run → result**
| Command | Result |
|---|---|
| Read-only `kubectl get` on mk4 | Nodes arm64 ×4; `letsencrypt-prod` Ready; `/` unclaimed on jithendar.com; **Certificate `jithendar-com` missing** (AUD-003) |
| `kubectl kustomize deploy/production \| kubectl apply --dry-run=server` | Pass. All 11 objects accepted (incl. cert-manager and Traefik CRDs); nothing persisted |
| `python scripts/argocd/validate.py` | Pass. 26 Applications, 90 unique resources, no overlapping ownership |
| `pytest tests/test_argocd_catalog.py` | Pass. 11 tests |
| `npm run lint` / `typecheck` / `test` / `build` | Pass / pass / 66 tests pass / pass |
| `docker build` | **Not run.** No local Docker engine; owner chose GitHub Actions |
| Workflow run | **Not run.** Needs a push |

**Open**
- Whether the self-hosted runner's AWS identity can push to the new repository is unverified (it pushes `roboshop-*` today).
- `node:26-alpine` is pinned by tag, not digest (same as the RoboShop images).
- WordPress leftovers in `jithendar`: PVCs `wordpress-mysql` and `wordpress-wordpress`, and Secret `wordpress-credentials`. Untouched; delete only with owner approval.

## Phase 2 — Content model & SEO foundation (2026-10-27)

**Status:** complete. Not deployed (Phase 6). jithendar.com still returns 503.

**What changed**
- Scaffolded Next.js 16.4.3 (App Router, React 19.3, TS 5.9, Tailwind 4) with `output: "standalone"`. It has its own `package.json`, separate from the RoboShop root.
- Zod content schema, a loader that reports every error at once, and `getPublishedContent()` as the single read path. Collection ↔ contentType rules.
- Routes: `/`, `/blog`, `/news`, `/projects`, `/<collection>/<slug>`, `/authors/<slug>`, `/sitemap.xml`, `/news-sitemap.xml`, `/robots.txt`.
- Metadata: `%s | Jithendar.com` titles, per-page absolute canonicals (none at root level), Open Graph and Twitter cards, one `<h1>` per page (MDX `#` demoted to `<h2>`).
- Non-production: `noindex, nofollow` meta tag (build time, `APP_ENV`), `X-Robots-Tag` header and disallow-all `robots.txt` (request time, `APP_ENV` + host).
- JSON-LD builders (Person, Organization, WebSite, ProfilePage, NewsArticle/BlogPosting/CreativeWork, BreadcrumbList) with `<` escaping.
- `src/config/redirects.ts` (empty, one-hop tested) and `src/config/gone.ts`: 410 for the 21 hijacked WordPress URLs (AUD-002). The proxy does its own trailing-slash 308, so gone URLs answer 410 in one hop.
- Baseline headers: `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`; `X-Powered-By` removed.

**New dependencies (justification)**
- `@mdx-js/mdx`: official MDX compiler, chosen over the less-maintained `next-mdx-remote`.
- `yaml`: frontmatter parser using the YAML 1.2 core schema, so timestamps stay strings with their offset. `gray-matter`/js-yaml would turn them into `Date` objects and lose the offset.
- `zod`: schema validation (required by the spec).
- Dev: `vitest` (TypeScript/TSX tests; the root's `node --test` would need extra tooling); `fast-xml-parser` (XML validity assertions); `@tailwindcss/typography` (article prose); `eslint-config-next`.
- `eslint` stays on 9.x (npm marks it deprecated). The plugins bundled with `eslint-config-next` 16.4.3 only accept ESLint ≤ 9. Revisit when they support 10.
- `typescript` 5.9.3 rather than the root's 7.0.2: `typescript-eslint` supports TS < 6.1 only.

**Files touched** (all under `sites/jithendar-com/`)
- Config: `package.json`, `package-lock.json`, `.nvmrc`, `.gitignore`, `.env.example`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`
- `src/config/{site,taxonomy,redirects,gone}.ts`, `src/proxy.ts`
- `src/lib/content/{schema,frontmatter,load,index}.ts`, `src/lib/seo/{canonical,jsonld,news-sitemap,sitemap,robots,xml}.ts`, `src/lib/dates.ts`, `src/lib/pages/{collection,article}.tsx`
- `src/components/{JsonLd,SiteHeader,SiteFooter,Mdx,ArticleList,Breadcrumbs}.tsx`
- `src/app/**` (layout, home, not-found, 3 collections × 2 routes, author, sitemap, news-sitemap, robots)
- `content/authors/jithendar-dharmapuri.mdx` (name only, `TODO(owner)` for the rest); empty `content/{blog,news,projects}/`
- `tests/*.test.ts` (8 files, 65 tests), `tests/fixtures/content/**` (9 articles covering every status and edge case)
- Docs: `README.md`, `docs/CONTENT_MODEL.md`; updated `AGENTS.md`, `docs/SEO_AUDIT.md`, `docs/IMPLEMENTATION_PLAN.md`

**Commands run → result** (Node 26.8.2)
| Command | Result |
|---|---|
| `npm install` | Pass. 505 packages. `unrs-resolver` postinstall not run (npm allowScripts); lint works without it |
| `npm run lint` | Pass. 0 problems |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Pass |
| `npm test` (vitest) | Pass. 8 files, 65 tests |
| `APP_ENV=production npm run build` | Pass. No warnings; standalone output holds `server.js`, `node_modules`, `content` only |
| Standalone server + curl, **fixture content** | Pass. Published article 200; draft/review/archived/future/wrong-collection 404; external canonical respected; single `<h1>`; JSON-LD dates match the page; sitemap excludes non-indexable URLs; news sitemap 48 h window (by real clock); 410s; 308 slash redirect relative, one hop; staging host → `X-Robots-Tag` + disallow-all robots |
| Standalone server + curl, **real content** | Pass. `/` 200 indexable; empty listings and author page `noindex, follow`; sitemap = homepage only; news sitemap valid and empty; CSS served; no server errors |
| Lighthouse | **Not run.** Phase 4 |
| Root `npm test` (RoboShop) | **Not run.** No RoboShop files changed |

**Note on the server check:** one intermediate run was answered by a stale server still bound to the port (`EADDRINUSE`). That run was discarded; results above come from fresh servers on the final builds.

**Open issues**
- Author bio, `jobTitle`, `sameAs` and the publication name: `TODO(owner)` (Phase 3).
- There is no published content yet, so the live site would be a homepage only. That's intentional: no fabricated posts.
- AUD-003 (shared TLS certificate) still unverified on the cluster.
- `www` → apex redirect must be recreated at ingress (Phase 6).

**Manual steps required (owner)**
1. Use Node 26: `export PATH=/opt/homebrew/bin:$PATH` (or reorder `PATH` in `~/.zshrc`).
2. Consider excluding `sites/jithendar-com/node_modules` and `.next` from Google Drive sync (AUD-016).
3. Phase 1 owner items 1, 2, 4 and 5 below are still open.

## Phase 1 — Audit & plan (2026-10-27)

**Status:** complete. Awaiting owner actions in IMPLEMENTATION_PLAN.md Phase 1.5.

**What changed**
- Stopped at first inspection: no Next.js repo existed, and the live site was a hijacked self-hosted WordPress. The owner removed WordPress (`argocd/wordpress.yaml` deleted, `argocd/kustomization.yaml` updated, both uncommitted) and confirmed its data is not needed.
- Created the site folder with standing rules and the audit/plan docs. No application code.

**Files touched**
- `sites/jithendar-com/AGENTS.md` — standing context and rules, adapted to verified state
- `sites/jithendar-com/docs/SEO_AUDIT.md` — findings AUD-001 to AUD-017
- `sites/jithendar-com/docs/IMPLEMENTATION_PLAN.md` — decisions D-1 to D-6, rescoped phases, risks
- `sites/jithendar-com/docs/PROGRESS.md` — this log

**Commands run → result**
| Command | Result |
|---|---|
| `curl` against public jithendar.com URLs (`/`, robots, sitemaps, feed, WP REST listings) | Ran. Evidence recorded in SEO_AUDIT.md |
| `openssl s_client` against jithendar.com:443 | Ran. Let's Encrypt cert for apex + www, valid until 2027-01-25 |
| `lint`, `typecheck`, `test`, `build` | **Not run.** No site code exists yet (Phase 2 scaffolds it) |
| Root `npm test` (RoboShop) | **Not run.** Out of scope; this phase changed no RoboShop code |
| `kubectl` against the cluster | **Not run.** AGENTS.md A3.3: agents do not touch the live cluster |

**Open issues:** AUD-002, AUD-003, AUD-004, AUD-005, AUD-007, AUD-010 to AUD-016.

**Manual steps required (owner)**
1. Check the shared TLS Certificate/Secret in namespace `jithendar` (AUD-003).
2. Check the workloads the hijacked pod could reach and rotate the credentials it could see (AUD-001).
3. Install Node ≥ 24 locally (AUD-015).
4. Confirm the publication name and host provider/spec (AUD-009).
5. Say whether an older WordPress.com export with real posts exists (AUD-008).
