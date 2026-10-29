# Appearance & site settings

Admin → **Appearance & settings** (`/admin/appearance`, administrators only) customises the public site
without code: structured, validated controls; a private draft; previews of the real pages; explicit
publishing; history with rollback; export/import. The old Admin → Settings page redirects here.

## Controls

| Section | What can be changed |
|---|---|
| General | Site and publication name, tagline, description; editorial time zone and date format; public contact email/location; GitHub, LinkedIn, X, YouTube, Mastodon; comments, reader sign-up, contact form; maintenance mode (message, Retry-After) |
| Branding | Logo for light and dark themes, phone logo, wordmark on/off; favicon, Apple touch icon; default share image |
| Header | 4 presets; width, height, sticky, navigation position, logo size; background (page, tinted, accent, image + mobile crop + overlay); search, theme switch, account menu, social icons; call-to-action button; announcement bar (text, link, tone, dismissible) |
| Navigation | Up to 8 menus; header menu choice (1–8 top-level items); items link to pages, topics, sections, authors or https URLs; one level of sub-items; reorder by arrow buttons (keyboard) or drag-and-drop; indent/outdent; new-tab option; desktop and phone previews |
| Footer | Presets (columns, simple, centred); up to 4 columns from menus or the topic list; logo, description, social, RSS, contact; copyright with `{year}`/`{site}`; background (tinted, page, inverted, image + overlay); alignment; spacing. Policy links and "Privacy choices" are always present |
| Typography & colours | 4 presets (Default, Editorial, Midnight, High contrast); body/heading font (Inter, IBM Plex Sans, Source Sans 3, Source Serif 4), code font (JetBrains Mono, IBM Plex Mono); heading weight; text scale; article line height; light and dark palettes (page, cards, text, secondary, meta, borders, accent, links) with live contrast ratios; page and reading width; section spacing; corner radius; button shape; default theme (device/light/dark); reset per field, reset section, restore default theme |
| Homepage | Sections from a registry (introduction, latest articles, hand-picked articles, topics, projects, editorial standards, author bio, call to action, plain-text block): add, remove, reorder, hide, duplicate; headings, text, links, images; layouts; searchable pickers for articles and topics; spacing and background |
| Blog & articles | Listing grid/list, cards per row, page size (6–24), excerpt lines, cover shape, which meta shows; article width and body size, breadcrumbs, author, updated date, reading time, cover, author card, table of contents (threshold, margin or inline), related articles (count), share links (X, LinkedIn, email, copy link) |
| Media | Image corners in articles, caption alignment, gallery columns; storage status and links |
| SEO & integrations | Homepage title, title separator, search-result preview; **status only** for Search Console/Bing verification, GA4, AdSense, ads.txt, consent default, IndexNow, Turnstile, email, social sign-in, Gemini |
| Advanced | Restricted custom CSS with live checks |
| Revision history | Published versions (who, when, note); load any into the draft or restore it live as a new version; export published/draft JSON; import with change summary; reset everything to defaults |

Not offered on purpose: a newsletter section (there is no newsletter service to connect, and an inert
form would mislead), arbitrary HTML/JavaScript, tracking-script fields, remote font URLs, landing pages
other than the homepage (other pages are edited in Admin → Pages).

## Architecture

- **One typed document**, `SiteConfig` (`src/lib/site-config/schema.ts`, zod, `SCHEMA_VERSION = 1`).
  Text is plain (React escapes it; control and bidi-override characters refused); links go through
  `safeHref` (same-site paths except `/admin`, `/api`, `/setup`, `/preview`; https URLs; `mailto:`);
  colours are `#rrggbb`; sizes are enumerations or bounded numbers; images reference our own media
  (`/media/{id}/…` or `/images/…`) with dimensions, alt text or a decorative flag, focal point and fit.
  Cross-field rules block publishing unreadable choices: text, secondary, meta and link colours need
  4.5:1 on the page background, button text 4.5:1 on the accent, white text over image overlays 4.5:1 in
  the worst case, and the header menu must keep 1–8 items.
- **Storage**: table `site_config` (migration `0007_site_config.sql`, additive) with two rows,
  `published` and `draft`, each carrying `version` (optimistic concurrency), `schema_version`, author and
  time. Published history goes to the existing `revision` table (`entity = 'site-config'`). Until the
  first publish the site reads the legacy `setting.site` row, migrated in memory (schema v0 → v1).
- **Lifecycle** (`src/lib/site-config/store.ts`): autosave writes the draft with the version it was based
  on (a stale version is a conflict, shown in the editor with "load theirs / keep mine"). Drafts may be
  incomplete; publishing validates the whole document, checks every referenced image still exists (taking
  its real dimensions), then in one transaction (both rows locked) writes `published`, records the
  revision and rebases the draft. Any failure leaves the previous configuration live. Restores publish a
  *new* version; nothing is deleted. Every write is admin-only on the server and audited.
- **Reads**: `getPublishedConfig()` caches per process for 60 s and is cleared on every replica through
  the existing Redis cache bus when something is published. Stored documents are normalised section by
  section: a section that fails validation falls back to its defaults (logged) rather than breaking the
  site. `getSettings()` remains as a compatibility view for library code.
- **Rendering**: `getSiteConfig()` (per request) feeds the layout, header, footer, homepage sections,
  listings and article pages. Theme, header metrics and media options compile to CSS custom properties
  (`src/lib/site-config/css.ts`) from validated values only. Fonts are declared with `next/font`
  (self-hosted, not preloaded except Inter). Background images use `next/image` (responsive AVIF/WebP from
  the existing pipeline, desktop + optional mobile crop). Structured data never depends on visual options.
- **Preview**: "Preview" opens `/api/admin/appearance/preview?path=…`, which checks the admin session,
  stores a one-hour token (existing `preview` table) and sets it in an HttpOnly cookie. Real pages then
  render the draft for that admin only (token + session + role re-checked per request), with a
  "Draft preview" bar. The proxy marks such responses `Cache-Control: private, no-store` and
  `X-Robots-Tag: noindex`. Closing the preview revokes the token. Pages may now be framed by the same
  origin only (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`) for the device previews.
- **Maintenance mode** is enforced in `src/proxy.ts`: public pages get a self-contained 503 page with
  `Retry-After`; admins and authors browse normally; `/admin`, `/account`, `/login`, `/api`, media and
  crawl files stay up. Robots/indexing settings are never touched, so turning it off restores normal
  indexing. The proxy reads the flag with one query cached 10 s per process.
- **Media references**: images used by the published or draft configuration count as "in use" in the
  media library.
- **Export/import**: `{ format: "jithendar-site-config", schemaVersion, exportedAt, config }`. The document
  holds no credentials by construction (integration keys stay in Kubernetes Secrets/ConfigMap). Imports
  are size-limited, reject `__proto__`/`constructor`/`prototype` keys, newer schema versions and any
  invalid value, never fetch anything, drop images that are not in this site's media library (with a
  warning), show the changed areas, and land in the draft.
- **Custom CSS** (off by default): ≤ 10 000 characters; refused: `<`, backslash escapes, `@import`,
  `@font-face`, `@namespace`, `@charset`, `url()`/`image()`/`image-set()`, `expression()`,
  `javascript:`, behaviour bindings, `position: fixed|sticky`, unbalanced braces or comments.

## Setup and deployment

No new secrets or services. The migration runs automatically at start-up. After deploying:

1. Sign in as an admin → Appearance & settings. The draft starts as the current site.
2. Change things, use **Preview** (phone/tablet/desktop), then **Publish**.

Integration identifiers stay where they are (`scripts/set-public-config.sh`, `docs/SEO_ANALYTICS_ADS.md`);
OAuth, R2, email and Gemini secrets stay in Secret `jithendar-com-env` (`docs/AUTH.md`, `docs/MEDIA.md`).
Rollback of the feature: deploy the previous image; it ignores `site_config` and keeps reading the legacy
settings row (changes made in the new editor would not apply until rolled forward).

## Tests

`tests/site-config.test.ts`: schema validation, contrast and navigation rules, link/text/image safety,
legacy migration and per-section fallbacks, prototype-pollution refusal, CSS generation and custom-CSS
restrictions, admin-only writes, private draft vs published, atomic publish with cache refresh, conflicts,
refused invalid publish (live config unchanged), missing images, rollback and restore-into-draft,
secret-free export, import validation and media handling, preview authorisation, maintenance 503, escaping
of configured text. Routing tests stub the maintenance read.

## Limitations

- Date format and time zone apply to the live site after publishing; previews show the published date
  format (formatting is synchronous and shared by many components).
- Maintenance mode and other replicas pick up a publish within 10 s (proxy) / immediately via Redis
  (pages); without Redis, other replicas refresh within 60 s.
- Background, logo and icon images must be in the media library (R2) or shipped under `public/images`.
- One shared draft for all admins (conflicts are detected, not merged).
