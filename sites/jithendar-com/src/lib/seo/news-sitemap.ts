import { site } from "@/config/site";
import { newsSitemapTypes } from "@/config/taxonomy";
import type { Article } from "@/lib/content";
import { canonicalFor, isSelfCanonical } from "./canonical";
import { escapeXml } from "./xml";

export const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;
export const NEWS_MAX_URLS = 1000;

/** Articles eligible for the Google News sitemap at `now`: news/analysis published in the last 48 hours. */
export function newsSitemapEntries(published: Article[], now: Date): Article[] {
  const cutoff = now.getTime() - NEWS_WINDOW_MS;
  return published
    .filter((a) => newsSitemapTypes.includes(a.frontmatter.contentType) && isSelfCanonical(a))
    .filter((a) => {
      const at = Date.parse(a.frontmatter.publishedAt!);
      return at >= cutoff && at <= now.getTime();
    })
    .slice(0, NEWS_MAX_URLS);
}

export function buildNewsSitemap(entries: Article[]): string {
  const urls = entries
    .map(
      (a) => `  <url>
    <loc>${escapeXml(canonicalFor(a))}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(site.publicationName)}</news:name>
        <news:language>${site.language}</news:language>
      </news:publication>
      <news:publication_date>${escapeXml(a.frontmatter.publishedAt!)}</news:publication_date>
      <news:title>${escapeXml(a.frontmatter.title)}</news:title>
    </news:news>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}${urls ? "\n" : ""}</urlset>
`;
}
