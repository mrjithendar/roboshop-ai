# Search engines, analytics and ads

Status: implemented 2026-10-29. Account-side steps **require manual configuration** (checklist at the end).
Nothing here guarantees indexing, rankings, traffic or AdSense approval.

## Indexing policy

| Route | Crawl | Index | Why |
|---|---|---|---|
| `/`, `/blog`, `/news`, `/projects` and their `/page/N` | yes | yes (self-canonical, incl. pagination) | listings of published work |
| Published articles `/{blog,news,projects}/{slug}` | yes | yes, unless the post sets **noindex** or a canonical elsewhere | original content |
| `/category/{slug}` | yes | only when it has an intro and enough posts (else `noindex, follow`) | avoid thin archives |
| `/tag/{slug}` | yes | `noindex, follow` | thin/duplicate |
| `/authors/{slug}` | yes | yes when the author has published posts | profile |
| Static pages (`/about`, `/privacy-policy`, `/cookies`, …) | yes | yes, unless the page sets noindex | publication info |
| `/search` | yes | `noindex` | internal search results |
| `/preview/{token}` | yes | `noindex`, staff login required, `Cache-Control: private, no-store` | drafts |
| `/admin/*`, `/account`, `/login`, `/setup` | yes | `noindex`; protected by login (robots.txt is not access control) | private |
| `/api/*` | **Disallow** in robots.txt | — | endpoints, not pages |
| Drafts, review, scheduled, trashed posts | — | not served (404); never in sitemaps or feeds | unpublished |
| Any non-production deployment or non-canonical host | yes | `X-Robots-Tag: noindex, nofollow` on every response + `robots` meta | staging must never be indexed; crawlable so the noindex is seen |

Canonical origin `https://jithendar.com` (`SITE_URL`); `http` → `https` and `www` → apex are 308 redirects in Traefik;
trailing slashes 308 to the slash-less URL; renamed slugs 308 to the new URL; removed WordPress URLs return 410.
CSS, JavaScript, fonts and media are never blocked. Media responses (`/media/…`, `/_next/image`) carry no noindex.

## What the site provides

- Metadata per page: unique title (SEO title override), description (meta description override), absolute canonical,
  Open Graph/Twitter cards (social overrides, social image → cover image fallback), `lang="en"`, landmarks.
- `/sitemap.xml` (canonical, indexable, published URLs only, `lastmod` from the last substantive update, image entries
  for covers) and `/news-sitemap.xml`; regenerated per request, so publishing/unpublishing is reflected immediately.
  Split with `generateSitemaps` if it ever nears 50,000 URLs (a warning is logged at 45,000).
- `/feed.xml` and per-category feeds (RSS 2.0).
- JSON-LD: `WebSite`, `Organization`, `Person`/`ProfilePage` for authors, `BlogPosting`/`NewsArticle` for articles
  (headline, description, canonical URL, image, `datePublished`, `dateModified`, author), `BreadcrumbList` where
  breadcrumbs are shown. Serialized with `<` escaped. No ratings, reviews, FAQs or other markup without visible content.
- Verification: `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` render meta tags on every page (DNS verification
  needs neither).
- IndexNow (Bing, Yandex, Seznam, Naver and other participants — **not Google**): key at `/{INDEXNOW_KEY}.txt`;
  canonical URLs are queued after publish, meaningful updates, unpublish, trash and slug changes; a Postgres job queue
  retries with backoff (1 min → 1 h, 6 attempts), de-duplicates pending URLs, logs failures and never blocks publishing.
  Google's Indexing API is not used (it is only for job postings and livestreams).

## Google Analytics 4

- Loads only in production, only when `GA4_MEASUREMENT_ID` is set, never on `/admin`, `/account`, `/login`, `/setup`,
  `/preview` (or a session that starts there), after hydration (no render blocking).
- Consent Mode v2: defaults `denied` for `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage` in the
  EEA, UK and Switzerland (`CONSENT_DEFAULT=strict`: everywhere), `ads_data_redaction` on, `allow_google_signals` off.
  Google's certified consent message (see AdSense) updates consent. While denied, GA4 sends cookieless pings
  (Google's "advanced" consent mode behaviour).
- Page views: `send_page_view: false`, then exactly one `page_view` per distinct location (initial load and every
  client-side navigation). **In GA4 turn off the history-based page views** (below), or navigations count twice.
- `page_location` is origin + path; query strings are dropped except `?page=`. Events never carry emails, phone numbers,
  form contents, user ids or credentials.

| Event | When | Parameters |
|---|---|---|
| `page_view` | each page | `page_location`, `page_title` |
| `article_engaged` | reader reaches the end of an article (once) | `content_group` (blog/news/projects), `article_slug` |
| `click` (outbound), `file_download` | GA4 enhanced measurement | set by Google |

No newsletter exists, so no newsletter events.

## Google AdSense

- `ADSENSE_CLIENT_ID` loads the official tag once per page view on public pages only, after hydration. Ad units come
  from `ADSENSE_SLOT_ARTICLE_END` (one responsive unit after the article body, labelled "Advertisement", 280 px reserved
  to avoid layout shift). Never on admin, login, editor, drafts, previews, 404 or empty pages; no refresh, no prompts.
- Outside production nothing loads unless `ADSENSE_TEST_MODE=true`, which requests Google test ads (`data-adtest="on"`).
  Automated tests never load the tag.
- `/ads.txt` serves `ADS_TXT` verbatim (from your account), otherwise 404. Nothing is invented.
- Consent: Google requires a Google-certified CMP integrated with the IAB TCF for personalised ads in the EEA, UK and
  Switzerland. Use AdSense **Privacy & messaging → European regulations** (Google's own certified CMP); the AdSense tag
  delivers it. The footer "Privacy choices" link (shown only when Google's consent API is ready) reopens it. There is
  no homemade banner.
- If you enable Auto ads, exclude `/admin`, `/login`, `/account`, `/setup` and `/preview` in AdSense; the tag is not
  loaded there anyway.

## Security headers

`Strict-Transport-Security` (1 year), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera,
microphone, geolocation, payment, USB off), `X-Frame-Options: DENY` (previews: `SAMEORIGIN` for the editor).
No Content-Security-Policy yet: with AdSense, Google recommends a nonce-based strict CSP, which would make every page
dynamic; tracked as a follow-up rather than shipping a broad allowlist.

## Owner checklist (manual)

**Google Search Console (domain property, DNS verification — preferred)**
1. search.google.com/search-console → Add property → **Domain** → `jithendar.com` → copy the TXT value.
2. Cloudflare dashboard → jithendar.com → DNS → Records → Add record: Type `TXT`, Name `@`, Content = the value, TTL Auto → Save.
   (DNS changes are made by you; this repository does not touch DNS.)
3. Back in Search Console → **Verify** (retry later if DNS has not propagated). Keep the record.
4. Indexing → Sitemaps → submit `https://jithendar.com/sitemap.xml` (and `news-sitemap.xml` if you publish news).
5. After publishing a post: URL Inspection (top bar) → paste its URL → **Test live URL** → check "Page can be indexed",
   rendered HTML and canonical → optionally **Request indexing**. Review Indexing → Pages for "Excluded by noindex"
   (expected for tags/search/admin) and real errors.
   Alternative: HTML tag → set `GOOGLE_SITE_VERIFICATION`.

**Bing Webmaster Tools**
1. bing.com/webmasters → **Import** from Google Search Console (verifies and imports sitemaps), or add the site and
   verify with DNS/meta tag (`BING_SITE_VERIFICATION`).
2. Sitemaps → confirm `https://jithendar.com/sitemap.xml` is listed.
3. Run `scripts/set-public-config.sh` and answer "y" to generate an IndexNow key; check `https://jithendar.com/<key>.txt`.

**GA4**
1. analytics.google.com → Admin → Create property → Web data stream for `https://jithendar.com` → copy `G-…`.
2. Stream → Enhanced measurement → ⚙ → Page views → advanced settings → turn **off** page changes based on browser history events. Keep outbound clicks and file downloads on.
3. Admin → Data retention: choose and record it in the privacy policy. Admin → Product links → **Search Console links** → link the property.
4. Validate: Admin → DebugView with Google Tag Assistant (tagassistant.google.com) connected to jithendar.com; navigate
   between pages and confirm exactly one `page_view` each, and `article_engaged` at the end of an article.

**AdSense** (approval is Google's decision)
1. Sites → add `jithendar.com`; copy the publisher ID (`ca-pub-…`) and the **ads.txt snippet**.
2. Ads → By ad unit → Display ad (responsive) → copy its slot ID.
3. Privacy & messaging → **European regulations** → create and publish a message for jithendar.com (enable consent mode
   if offered). Consider the US state regulations message too.
4. `scripts/set-public-config.sh` (publisher ID, slot, ads.txt line), restart, then confirm `https://jithendar.com/ads.txt`.
5. Complete and publish the privacy and cookies pages (Admin → Pages; drafts are bundled) before applying.

**Consent check**: from an EEA location (or VPN), confirm the consent message appears, analytics cookies (`_ga`) are not
set before consent, and "Privacy choices" reopens the message.

## Official documentation used

- Google Search Central: [robots meta / noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing),
  [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
  [image sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps),
  [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article),
  [verify site ownership](https://support.google.com/webmasters/answer/9008080)
- Bing: [add and verify a site](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b),
  [sitemaps](https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed),
  [import from Search Console](https://blogs.bing.com/webmaster/2019/9/Import-sites-from-Search-Console-to-Bing-Webmaster-Tools/)
- [IndexNow documentation](https://www.indexnow.org/documentation)
- Google tag / GA4: [consent mode](https://developers.google.com/tag-platform/security/guides/consent),
  [single-page applications](https://developers.google.com/analytics/devguides/collection/ga4/single-page-applications),
  [enhanced measurement](https://support.google.com/analytics/answer/9216061)
- AdSense: [certified CMP requirement](https://support.google.com/adsense/answer/13554116),
  [ads.txt](https://support.google.com/adsense/answer/12171612),
  [Funding Choices / Privacy & messaging API](https://developers.google.com/funding-choices/fc-api-docs)
- Next.js: [sitemap.xml](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) and the bundled docs in `node_modules/next/dist/docs`.
