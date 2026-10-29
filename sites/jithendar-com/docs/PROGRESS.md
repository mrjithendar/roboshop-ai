# Progress log — jithendar.com

## Sign-out, password toggles, discussions, social-login audit, article header (2026-10-29, owner request)

**What changed**
- Sign-out (`docs/AUTH.md`): one `signOutAndLeave()` for every control — server-side session deletion, private browser data cleared, full `replace()` to `/login?signedOut=1`. Mobile admin menu now has Sign out (the sidebar block is desktop-only). `SessionGuard` on admin/account layouts (bfcache reload, session ended elsewhere/expired → login). `no-store` on admin, admin API, comment API and login. Accurate "session expired" vs "not signed in". A race between the guard and sign-out (found in browser checks) is handled by `isSigningOut()`.
- `PasswordInput` with show/hide toggle on all password fields (login, sign-up, setup, admin secrets).
- Discussions (`docs/COMMENTS.md`): replies (2 visible levels), Markdown + preview with server-side sanitising, likes, reports, edit/delete, permalinks, sort + paging, moderation tabs/actions with audit, per-post open/locked/closed, approval and edit-window settings. Replaces `CommentForm`/old `approvedComments`.
- Article page: header spans the reading column plus the right column from `lg` (title 952px vs body 688px at 1440); standfirst stays at reading width; the cover image block is removed (cover still stored, edited, on cards, in Open Graph and Article JSON-LD). The now-unused "Cover image" Appearance toggle was removed (schema field kept).
- Social login audit: already complete (Google/GitHub, PKCE/state/nonce, lowest role, no implicit linking, explicit linking, error messages). No code changes; added tests for comment-anchor return URLs and off-site/protocol-relative refusal.
- Migration `0008_discussions.sql` (additive). New dev dependency `happy-dom@20.14.6` (DOM for the password toggle interaction tests only).

**Files**: `src/lib/{sign-out,comments,comment-markdown,comment-types,session,settings}.ts`, `src/components/{SessionGuard,AccountMenu,Comments,icons}.tsx`, `src/components/ui/PasswordInput.tsx`, `src/components/discussion/*`, `src/components/admin/{AdminNav,ui}.tsx`, `src/app/{account/SignOutButton,account/layout,account/settings/SessionControls,admin/layout,admin/comments/page,login/page,login/LoginForm,setup/SetupForm,admin/storage/page,admin/backups/page,admin/appearance/panels}.tsx`, `src/app/_actions/{comments,public}.ts`, `src/app/api/comments/[postId]/route.ts`, `src/lib/pages/article.tsx`, `src/lib/site-config/schema.ts`, `src/db/schema.ts`, `src/db/migrations/0008_discussions.sql`, `src/app/globals.css`, `next.config.ts`, tests `discussions`, `password-input`, `sign-out`, `social-auth` (+ sign-out/return URL cases), `article-route.test.tsx` (renamed from .ts; cover case), docs `AUTH.md`, `COMMENTS.md`.

**Commands**: lint pass; typecheck pass; vitest 35 files / 345 tests pass; production build pass; browser checks (Chrome, `next start`, 1440px and 390px) 45/45 pass.

**Manual steps**: OAuth clients still need creating (`docs/AUTH.md`); no other configuration. Review comment settings in Admin → Appearance → General → Features before publishing.

**Open**: no password-reset/change-password pages exist (reset emails point nowhere useful); social login not tested against real providers.

## Appearance & site settings (2026-10-29, owner request)

**What changed**
- Admin → Appearance & settings (`/admin/appearance`, admins only): General, Branding, Header, Navigation, Footer, Typography & colours, Homepage, Blog & articles, Media, SEO & integrations, Advanced, Revision history. Details and the full control list: `docs/APPEARANCE.md`.
- Typed, versioned `SiteConfig` (zod) with safe links, plain text, hex colours, bounded values, own-media images, contrast and navigation rules; legacy settings migrated; per-section fallbacks.
- Lifecycle: shared private draft with autosave and conflict detection → preview of the real pages (admin-only cookie token, no-store, noindex, phone/tablet/desktop) → atomic publish (transaction, revision, audit, cache bus) → history with restore; export/import of non-secret settings into the draft.
- Public site now reads the configuration: theme tokens/fonts via CSS variables, header (presets, inverse backgrounds, CTA, social, nested menus with keyboard submenus), dismissible announcement, footer, homepage section registry, listing/article presentation and page size, share links, date format/time zone, favicon/icons, configurable default share image.
- Maintenance mode in the proxy (503 + Retry-After, staff bypass, indexing untouched). Same-origin framing allowed for previews.
- Migration `0007_site_config.sql` (additive). No new dependencies. Old `/admin/settings` redirects.

**Files**: `src/lib/site-config/*`, `src/app/admin/appearance/*`, `src/app/api/admin/appearance/preview/route.ts`, `src/components/{SiteHeader,NavLinks,SiteFooter,Logo,AnnouncementBar,DismissAnnouncement,PreviewBanner,ShareLinks,CopyLink,ArticleList,CoverImage,TopicGrid}.tsx`, `src/components/sections/HomeSections.tsx`, `src/components/site/*`, `src/app/{layout,page,opengraph-image}.tsx`, `src/lib/{settings,dates,media}.ts`, `src/lib/pages/{article,listing,listings}.tsx|ts`, `src/lib/og/card.tsx`, `src/proxy.ts`, `next.config.ts`, `src/app/globals.css`, `src/db/schema.ts`, tests `site-config` (+ `indexing`, `seo-integrations`, `social-auth` adjusted), `docs/APPEARANCE.md`.

**Commands**: see the final report of this change (lint, typecheck, 32 test files, production build, browser flows and width audit).

**Manual steps**: none required; after deploying, review the draft in Admin → Appearance and publish when ready.

## Redesign + social sign-in, profiles and header account menu (2026-10-29, owner request)

**What changed**
- Design system (`docs/DESIGN_SYSTEM.md`): semantic colour tokens with one blue accent and a neutral grey scale, fluid type tokens, reading/page widths, radii, shadows, section rhythm; dark mode now follows the system *and* remembers an explicit choice (header toggle, footer System/Light/Dark) without a flash. Removed gradients, glass, grid backgrounds and the decorative hero mosaic; calmer category/type badges.
- Public pages: new header (accent underline for the current section, search, theme, account control far right; search/theme move into the mobile menu on phones), footer, homepage (text intro, one primary action, featured + recent, compact topics, projects only when published), article page (≈70-character column, TOC in the right margin ≥1280px, labelled code blocks, contained sources/corrections, separated ad slot), listings, static pages, author, search, 404 and a new runtime error page.
- Shared components: buttons/inputs/fields/alerts with sizes and states (16px inputs), pagination, tags, breadcrumbs, cards; ~40 files moved from duplicated light/dark class pairs to tokens.
- Admin: full-height sidebar shell, full-width header, accent current state, table/stat/header primitives, loading skeleton; editor action bar no longer slides under the sticky header; an expired session during save/autosave shows a message instead of navigating away (draft kept locally).
- Auth (`docs/AUTH.md`): Google + GitHub via Better Auth (PKCE, state, OIDC nonce, minimal scopes), buttons only when configured, readable callback errors, safe `next` handling, lowest role for every self-registration, no implicit account linking, explicit link/unlink with fresh-session rule and last-method protection, encrypted provider tokens, `/update-user` disabled.
- Accounts: `/account` (avatar, display name, bio, website, social links; server-validated allowlist) and `/account/settings` (email, sign-in methods, sign out / sign out everywhere); header account menu (keyboard, outside click, Escape, focus return, viewport-safe). Avatars re-encoded to 512px WebP without metadata, stored in R2 under `images/avatars/{user-id}/`, old uploads deleted on replace/remove. App rate limits for profile and avatar changes. `Cache-Control: private, no-store` on account and auth routes.
- Migration `0006_account_profile.sql` (additive, defaults). New direct dependency: `sharp@0.35.5` (already installed as Next's image engine; now declared because avatars use it directly).

**Files**: `src/app/globals.css`, `src/app/{layout,page,error,not-found}.tsx`, `src/app/account/**`, `src/app/login/**`, `src/app/admin/{layout,loading}.tsx`, admin pages (token pass), `src/app/media/avatars/[userId]/[file]/route.ts`, `src/components/{AccountMenu,UserAvatar,HideOnAdmin,SiteHeader,NavLinks,SiteFooter,Logo,Container,PageHeader,ArticleList,TopicGrid,CodeBlock,TableOfContents,Pagination,TagList,Breadcrumbs,AuthorCard,CoverImage,ContentTypeBadge,categoryStyle,icons}.tsx`, `src/components/theme/*`, `src/components/ui/form.tsx`, `src/components/admin/{ui,AdminNav}.tsx`, `src/lib/{auth,auth-providers,auth-errors,avatar,avatar-url,profile,rate-limit,safe-next,session,admin}.ts`, `src/lib/mdx/compile.ts`, `src/lib/pages/*.tsx`, `src/db/schema.ts`, `next.config.ts`, `deploy/base/networkpolicy.yaml` (comment only), `scripts/set-oauth-config.sh`, `.env.example`, `package.json`, tests `social-auth`, `account-helpers`, docs `AUTH.md`, `DESIGN_SYSTEM.md`.

**Commands**: see the final report of this change (lint, typecheck, 31 test files (278 tests), production build, browser checks at 320–1920px light/dark, account-menu keyboard flow, profile form, theme persistence).

**Manual steps**: create the Google and GitHub OAuth clients (`docs/AUTH.md`), `scripts/set-oauth-config.sh mk4`, restart; verify live sign-in and avatar upload with R2.

## Search engines, analytics, AdSense and the block editor (2026-10-29, owner request)

**What changed**
- SEO: SEO/social/noindex fields for posts and pages; image sitemap entries; noindex posts and pages left out of sitemaps; staging crawlable with `X-Robots-Tag: noindex` (was `Disallow: /`, which hides noindex); Google/Bing verification meta from runtime config; IndexNow with a Postgres job queue (retries, dedupe, never blocks publishing); HSTS and Permissions-Policy; `/search` rendered per request.
- GA4 (Consent Mode v2 defaults, manual de-duplicated page views, `article_engaged`, no PII, never on private routes) and AdSense (one tag, labelled reserved slot after articles, test mode outside production, `/ads.txt` verbatim, Google's certified CMP + "Privacy choices" link). Draft privacy and cookies pages bundled for owner review (not auto-published). Details: `docs/SEO_ANALYTICS_ADS.md`.
- Editor: visual block editor over canonical Markdown with protected shortcode blocks and a fidelity check, slash commands, searchable inserter, block move/duplicate/delete, code languages, figures/galleries, safe links; publish/schedule/update/unpublish; server autosave + recovery; optimistic concurrency; revisions with preview/restore; device previews; trash/restore/duplicate; posts and pages dashboards; media search/paging/drag-drop/paste, alt editing and usage warnings; server-side scheduler. Details: `docs/EDITOR.md`.
- Migration `0005_editor_seo.sql`: new columns (defaults keep existing behaviour), `revision` (baseline revision for all existing content), `autosave`, `job`. Additive only; rollback = deploy the previous image (it ignores the new columns/tables), but note it does not know about trash or scheduling: trashed posts would show again and scheduled posts would stay unpublished until rolled forward.
- Security: render-time filter for unsafe URL schemes (`lib/mdx/safe-urls.ts`), save-time link validation.

**Commands**: see the final report (lint, typecheck, 29 test files, build, HTTP checks, browser flows).

**Manual steps**: Search Console/Bing/GA4/AdSense/consent checklist in `docs/SEO_ANALYTICS_ADS.md`; `scripts/set-public-config.sh mk4`; review and publish the bundled privacy/cookies drafts (Admin → Pages); complete "Owner input needed" items.

## Responsive pages, R2 media, Gemini "Generate image" (2026-10-29, owner request)

**What changed**
- Media storage moved from S3 to Cloudflare R2 (S3 API): keys `jithendar/www/media/{type}/{yyyy}/{mm}/{id}.{ext}`; images, video, audio, PDF; presigned direct uploads with server-side verification (size, SHA-256, magic bytes); private files via 5-minute signed links; legacy S3 rows still served until migrated; resumable, verified, non-destructive S3 → R2 migration with dry run, manifest and rollback (Admin → Storage). Details: `docs/MEDIA.md`.
- "Generate image" beside the cover controls: Gemini Interactions API (model from `GEMINI_IMAGE_MODEL`), preview → Use as cover / Regenerate / Discard, alt text required, per-user hourly + concurrency and site-wide daily limits, timeout + cancel, temp storage with 1 h app cleanup and 1-day R2 lifecycle backstop; prompts never stored.
- Responsive: fixed page-level overflow on static pages (sidebar nav) and the contact form (Turnstile compact below 300 px); collapsible admin menu below `lg`; shared accessible dialog (full-screen on phones, focus trap, Escape); tables scroll in their own region; `::video`, `::audio`, `::embed` shortcodes in fixed-ratio frames; cover focal point; footer touch targets; `minmax(0,1fr)` grids.
- Image pipeline bounded: fixed widths/quality, 12 MB source cap, no redirects, 200 MB LRU disk cache; LCP images eager + high priority (Next 16 deprecates `priority`).
- Fixed: server-action uploads were capped at Next's 1 MB default (now 11 MB); local dev without `DATABASE_URL` crashed (PGlite bundled by Turbopack → now external).
- New dependency: `@aws-sdk/s3-request-presigner@3.1157.0` (Cloudflare's documented way to presign R2 URLs; same SDK version as `client-s3`). Gemini uses `fetch` (no SDK).

**Files**: `src/lib/{storage,storage-legacy,media,media-migration,gemini,image-generation,health,db-admin}.ts`, `src/lib/mdx/{shortcodes,tables,compile,html}.ts`, `src/app/media/[id]/[name]/route.ts`, `src/app/api/admin/{images,media-migration}/…`, `src/app/admin/{storage,media}/…`, `src/app/admin/_actions/shared.ts`, `src/components/admin/{Dialog,GenerateImageDialog,CoverImagePicker,MediaPicker,AdminNav}.tsx`, `src/components/{CoverImage,ContentImage,ContentMedia,Mdx,Turnstile,ContactForm,SiteFooter}.tsx`, `src/lib/pages/{article,page-view}.tsx`, `src/app/admin/layout.tsx`, `src/app/globals.css`, `src/db/{schema.ts,migrations/0004_r2_media.sql}`, `next.config.ts`, `deploy/base/{deployment,networkpolicy}.yaml`, `deploy/r2/{cors,lifecycle}.json`, `scripts/set-media-config.sh`, `.env.example`, `docs/{MEDIA,DEPLOYMENT}.md`, tests `media-storage`, `r2-config`, `image-generation`, `media-migration`, `responsive-content`.

**Commands**: see the final report of this change (lint, typecheck, tests, build, browser audit at 320–1920 px).

**Manual steps**: create the R2 bucket, token, CORS and lifecycle rules; `scripts/set-media-config.sh mk4`; choose `GEMINI_IMAGE_MODEL`; deploy; migrate legacy media if any (`docs/MEDIA.md`). Update the privacy policy to mention Gemini (editor-only) and YouTube/Vimeo embeds if used.

## CI deploys with kubectl, Argo CD removed (2026-10-27, owner request)

- **Why the live site did not change:** the owner ran `kubectl apply -k` from a checkout one commit behind `origin/master`. The local overlay pinned the old image (`dcdd3d7`), and CI had already pinned the new one (`d54da88`, `sha256:430f…`). The CI `deploy` job for that run was also waiting for an Argo CD app that had been deleted.
- **New deploy job:** loads `JITHENDAR_KUBECONFIG` (environment `production`), pins the digest built in the same run, then server dry-runs and applies `deploy/production`. It waits for `rollout status` (`rollout undo` on failure), waits for `/api/health` to report the commit, and runs the smoke test. The credential file is removed in an `always()` step.
- **CI identity:** `deploy/ci-access/rbac.yaml` (ServiceAccount, Role, RoleBinding; namespace `jithendar`; get/list/watch/create/update/patch on only the kinds in the overlay; read-only pods, events, replicasets; no delete; no Secrets). `scripts/ci-kubeconfig.sh` mints a 1-year token, refuses over-privileged or non-working credentials, and stores the GitHub secret.
- **Argo CD:** removed `argocd/jithendar-com.yaml` and its catalog entry, reverted the auto-sync exception in `scripts/argocd/validate.py`, updated `argocd/README.md`, and set `tests/test_argocd_catalog.py` to 25 apps. That test was already failing on `master` (26 expected, 25 present) after jithendar-com was commented out. During this change, a first edit accidentally commented out `jaeger.yaml`; caught by the validator count and fixed before reporting.
- **Checks:** actionlint, shellcheck, `validate.py` (25 apps, 79 resources), catalog tests 11 passed, RBAC server dry run passed.
- **Not done (blocked by the agent permission policy, owner to run):** `kubectl apply -f deploy/ci-access/rbac.yaml` and `scripts/ci-kubeconfig.sh mk4`. Until then the `deploy` job fails at "Load cluster credentials" with a clear message.

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
