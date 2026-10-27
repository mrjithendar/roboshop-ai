# Google News readiness

Google News discovers and ranks publishers automatically; there is no application to submit, and inclusion is never guaranteed. This checklist covers what the site controls. Status as of 2026-10-27.

## Technical

| Item | Status | Where |
|---|---|---|
| Stable, unique article URLs (`/news/<slug>`, `/blog/<slug>`) | Done | `src/app/*/[slug]` |
| Self-referencing absolute canonical on every indexable page | Done | `src/lib/seo/canonical.ts` |
| `NewsArticle` JSON-LD for news/analysis, matching visible headline, dates, author | Done | `src/lib/seo/jsonld.ts` |
| Visible original publish time and "Updated" time (only for substantive edits) | Done | Article page; `updatedAt` rule in `docs/CONTENT_MODEL.md` |
| News sitemap: news/analysis from the last 48 h, publication name + language | Done | `/news-sitemap.xml` |
| `robots.txt` lists both sitemaps and does not block Googlebot or Googlebot-News | Done | `/robots.txt` |
| Drafts, review and future items never public | Done (tested) | `getPublishedContent()` |
| HTTPS, single canonical host (www → apex, http → https, one hop) | Done | Traefik middlewares |
| Fast, accessible pages | Lighthouse (local, 2026-10-27): accessibility 100; desktop performance 100; mobile 95–96 | `docs/PROGRESS.md` |
| Featured images ≥ 1200 px wide with alt text | Supported; none published yet | `featuredImage` frontmatter |
| Search Console property verified, sitemaps submitted | **Manual, not done** | See below |

## Editorial and transparency

| Item | Status |
|---|---|
| About page: who publishes, what is covered | Drafted. **Owner TODO:** who runs it, legal entity, location |
| Author page with name and verifiable profile | Done (GitHub). **Owner TODO:** bio, job title, more profiles |
| Bylines linking to the author page | Done |
| Contact page | Drafted. **Owner TODO:** dedicated email address |
| Editorial, corrections and AI-use policies | Drafted from the workflow in this repo. **Owner TODO:** sponsorship rules, response time, AI providers |
| Privacy policy and terms | Drafted. **Owner TODO:** log retention, rights, licence, governing law; legal review |
| Content-type labels (News, Analysis, Tutorial, Opinion, Curated summary, Sponsored) | Done, visually distinct |
| Sources listed on news and curated items | Enforced by schema |
| Corrections log on articles | Done |
| Regular, original news output | **Not yet.** No articles are published |

`TODO(owner)` items are hidden in production builds (`<Todo>` renders nothing), so the pages are publishable now. They are still gaps a reader or reviewer could notice. Run `npm run preview` to see them highlighted.

## Manual steps (owner)

1. Verify `jithendar.com` in [Google Search Console](https://search.google.com/search-console) (DNS TXT record).
2. Submit `https://jithendar.com/sitemap.xml` and `https://jithendar.com/news-sitemap.xml`.
3. Request removal of the hijacked WordPress URLs (they return 410; see `SEO_AUDIT.md` AUD-002).
4. Optionally create a Publisher Center profile for branding. It is not required for inclusion.

## What Google decides

Whether and where articles appear in Google News, Top Stories or Discover, and how they rank. Nothing in this repository can guarantee or check that. No Search Console data has been looked at; none is claimed.
