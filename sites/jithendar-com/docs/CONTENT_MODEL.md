# Content model

Every article is one `.mdx` file under `content/<collection>/<slug>.mdx`. The file name must equal `slug`.
The build fails on any invalid file, and `npm test` validates `content/` too. One error message lists every problem.

| Collection | Path | Allowed `contentType` |
|---|---|---|
| `blog` | `/blog/<slug>` | `analysis`, `tutorial`, `opinion`, `curated` |
| `news` | `/news/<slug>` | `news`, `analysis` |
| `projects` | `/projects/<slug>` | `project` |
| authors | `/authors/<slug>` | (author profile, not an article) |
| pages | `/<slug>` | (about, contact, policies: `title`, `slug`, `description`, optional `updatedAt`) |

Categories and content-type labels live in `src/config/taxonomy.ts`. That file is the single source of truth.

## Frontmatter

```yaml
---
title: "10–110 characters"
slug: kebab-case-matching-file-name
description: "50–160 characters; used for meta description and listings."
author: jithendar-dharmapuri        # file in content/authors/
category: kubernetes                # key from src/config/taxonomy.ts
tags: [GitOps, Argo CD]             # lower-cased and de-duplicated automatically
contentType: tutorial               # news | analysis | tutorial | opinion | project | curated
status: draft                       # draft | review | published | archived
publishedAt: "2026-10-27T10:30:00+05:30"   # ISO 8601 with offset; required when published
updatedAt: "2026-10-28T09:00:00+05:30"     # optional; >= publishedAt; substantive edits only
canonicalUrl: https://example.com/original # optional; for syndicated content
featuredImage:                      # optional; alt is required
  src: /images/example.png
  alt: Describe the image
  width: 1200
  height: 630
sources:                            # required (>= 1) for news and curated
  - title: Source title
    url: https://example.com/source
    publisher: Example
corrections:                        # optional, shown on the page
  - date: "2026-10-28T09:00:00+05:30"
    note: What was corrected.
sponsored: false                    # if true, sponsor is required
sponsor: Sponsor name
related: [projects/roboshop-ai]     # optional explicit related reading, "<collection>/<slug>"
---
```

Slugs `page`, `feed`, `category` and `tag` are reserved for routes. `related` entries must point at existing content.

Unknown keys are rejected, so typos fail the build instead of being silently ignored. Quote timestamps.
Values with no offset (`2026-10-27T10:30:00`) and date-only values (`2026-10-27`) are rejected.

## Visibility

`getPublishedContent()` in `src/lib/content/index.ts` is the only way code reads articles. It returns items where:

- `status` is `published`, **and**
- `publishedAt` is at or before the current time.

Everything else is invisible. Draft, review, archived and future-dated items return 404. They never appear in listings, category/tag pages, `sitemap.xml`, `news-sitemap.xml`, RSS feeds, the search index, related reading or JSON-LD.

**Scheduled publishing.** A merged item with a future `publishedAt` goes live on the first request after that time. Article pages revalidate every 5 minutes, so a 404 cached before go-live can last up to 5 minutes.

## Previewing unpublished work

`npm run preview` starts the dev server with `CONTENT_PREVIEW=true`. Items in `review` then appear everywhere with a **Preview: not published** badge (dated now if they have no `publishedAt`). Preview is ignored whenever `APP_ENV=production`, so it can never reach the live site.

## Owner placeholders

`<Todo>…</Todo>` in any MDX marks a fact only the owner can supply. It renders as a highlighted box in development and preview, and as **nothing** in production builds.

## Body

- The page renders the title as the only `<h1>`. Start body headings at `##`. A stray `#` is rendered as `<h2>`.
- Headings get stable ids; two or more `##`/`###` headings produce an "On this page" table of contents.
- Fenced code blocks are highlighted on the server by Shiki (light and dark themes) and get a copy button.
- Internal links (`/…`) must resolve: published content may link only to public routes. `npm test` fails on broken links.
- MDX is compiled on the server. MDX can run code, so every content change must go through a reviewed pull request (AGENTS.md rule 10).

## Indexing rules

| Page | Indexed when | Otherwise |
|---|---|---|
| Article | Always (if published) | 404 |
| Article with external `canonicalUrl` | Never in our sitemaps; canonical points to the original | — |
| `/blog`, `/news`, `/projects` | At least 1 published item | `noindex, follow`, left out of the sitemap |
| `/category/<category>` | At least 3 published items (each category has an intro in `src/config/taxonomy.ts`) | `noindex, follow`, left out of the sitemap |
| `/tag/<tag>` | Never (no editorial intro) | `noindex, follow` |
| `/search` | Never | `noindex, follow` |
| `/<listing>/page/<n>` | Same rule as page 1; self canonical; not in the sitemap | — |
| `/authors/<slug>` | Author has at least 1 published item | `noindex, follow`, left out of the sitemap |
| Any page outside production or off `jithendar.com` | Never | `noindex, nofollow` meta tag + `X-Robots-Tag` header; `robots.txt` disallows all |

`news-sitemap.xml` lists `news` and `analysis` items published within the last 48 hours (max 1,000). It is computed per request, so items age out without a rebuild.
