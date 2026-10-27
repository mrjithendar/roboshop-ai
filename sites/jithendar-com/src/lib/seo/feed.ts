import { absoluteUrl, site } from "@/config/site";
import type { Article } from "@/lib/content";
import { rfc822 } from "@/lib/dates";
import { canonicalFor } from "./canonical";
import { escapeXml } from "./xml";

export const FEED_ITEMS = 30;

/** RSS 2.0 feed of already-published articles (callers pass getPublishedContent output). */
export function buildRss({ title, description, path, selfPath, articles, categoryLabel = (s) => s }: {
  categoryLabel?: (slug: string) => string;
  title: string;
  description: string;
  path: string;
  selfPath: string;
  articles: Article[];
}): string {
  const items = articles.slice(0, FEED_ITEMS).map((a) => {
    const fm = a.frontmatter;
    const link = canonicalFor(a);
    return `    <item>
      <title>${escapeXml(fm.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${rfc822(fm.publishedAt!)}</pubDate>
      <description>${escapeXml(fm.description)}</description>
      <category>${escapeXml(categoryLabel(fm.category))}</category>
    </item>`;
  });
  const lastBuild = articles[0] ? `\n    <lastBuildDate>${rfc822(articles[0].frontmatter.updatedAt ?? articles[0].frontmatter.publishedAt!)}</lastBuildDate>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(absoluteUrl(path))}</link>
    <description>${escapeXml(description)}</description>
    <language>${site.language}</language>
    <atom:link href="${escapeXml(absoluteUrl(selfPath))}" rel="self" type="application/rss+xml"/>${lastBuild}
${items.join("\n")}${items.length ? "\n" : ""}  </channel>
</rss>
`;
}

export function rssResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=600" },
  });
}
