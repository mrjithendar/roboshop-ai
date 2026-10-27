import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";
import { collections } from "@/config/taxonomy";
import { getAuthors, getPublishedContent, lastModified, type Article } from "@/lib/content";
import { isSelfCanonical } from "./canonical";

function newest(articles: Article[]): string | undefined {
  return articles.map(lastModified).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

/** Canonical, indexable, published URLs only. Pages that render noindex (empty listings/authors) are left out. */
export function buildSitemap(now: Date = new Date()): MetadataRoute.Sitemap {
  const published = getPublishedContent({ now });
  const entries: MetadataRoute.Sitemap = [{ url: absoluteUrl("/"), lastModified: newest(published) }];

  for (const collection of collections) {
    const items = published.filter((a) => a.collection === collection);
    if (items.length > 0) entries.push({ url: absoluteUrl(`/${collection}`), lastModified: newest(items) });
  }
  for (const author of getAuthors()) {
    const items = published.filter((a) => a.frontmatter.author === author.slug);
    if (items.length > 0) entries.push({ url: absoluteUrl(author.path), lastModified: newest(items) });
  }
  for (const article of published.filter(isSelfCanonical)) {
    entries.push({ url: absoluteUrl(article.path), lastModified: lastModified(article) });
  }
  return entries;
}
