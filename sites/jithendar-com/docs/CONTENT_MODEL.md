# Content model

Every article is one `.mdx` file under `content/<collection>/<slug>.mdx`. The file name must equal `slug`.
The build fails on any invalid file, and `npm test` validates `content/` too. One error message lists every problem.

| Collection | Path | Allowed `contentType` |
|---|---|---|
| `blog` | `/blog/<slug>` | `analysis`, `tutorial`, `opinion`, `curated` |
| `news` | `/news/<slug>` | `news`, `analysis` |
| `projects` | `/projects/<slug>` | `project` |
| authors | `/authors/<slug>` | (author profile, not an article) |

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
---
```

Unknown keys are rejected, so typos fail the build instead of being silently ignored. Quote timestamps.
Values with no offset (`2026-10-27T10:30:00`) and date-only values (`2026-10-27`) are rejected.

## Visibility

`getPublishedContent()` in `src/lib/content/index.ts` is the only way code reads articles. It returns items where:

- `status` is `published`, **and**
- `publishedAt` is at or before the current time.

Everything else is invisible. Draft, review, archived and future-dated items return 404. They never appear in listings, `sitemap.xml`, `news-sitemap.xml` or JSON-LD. The same applies to feeds, search and related lists in later phases.

**Scheduled publishing.** A merged item with a future `publishedAt` goes live on the first request after that time. Article pages revalidate every 5 minutes, so a 404 cached before go-live can last up to 5 minutes.

## Body

- The page renders the title as the only `<h1>`. Start body headings at `##`. A stray `#` is rendered as `<h2>`.
- MDX is compiled on the server. MDX can run code, so every content change must go through a reviewed pull request (AGENTS.md rule 10).

## Indexing rules

| Page | Indexed when | Otherwise |
|---|---|---|
| Article | Always (if published) | 404 |
| Article with external `canonicalUrl` | Never in our sitemaps; canonical points to the original | — |
| `/blog`, `/news`, `/projects` | At least 1 published item | `noindex, follow`, left out of the sitemap |
| `/authors/<slug>` | Author has at least 1 published item | `noindex, follow`, left out of the sitemap |
| Any page outside production or off `jithendar.com` | Never | `noindex, nofollow` meta tag + `X-Robots-Tag` header; `robots.txt` disallows all |

`news-sitemap.xml` lists `news` and `analysis` items published within the last 48 hours (max 1,000). It is computed per request, so items age out without a rebuild.
