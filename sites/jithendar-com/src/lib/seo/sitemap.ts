import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";
import { collections } from "@/config/taxonomy";
import { getCategories } from "@/lib/categories";
import { articlesInCategory, getAuthors, getPages, getPublishedContent, isCategoryIndexable, lastModified, type Article } from "@/lib/content";
import { isSelfCanonical } from "./canonical";

function newest(articles: Article[]): string | undefined {
  return articles.map(lastModified).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

/**
 * Canonical, indexable, published URLs only. Pages that render noindex (empty listings,
 * thin taxonomy, tag pages, search, pagination beyond page 1) are left out.
 */
export async function buildSitemap(now: Date = new Date()): Promise<MetadataRoute.Sitemap> {
  const query = { now, preview: false };
  const published = await getPublishedContent(query);
  const entries: MetadataRoute.Sitemap = [{ url: absoluteUrl("/"), lastModified: newest(published) }];

  for (const collection of collections) {
    const items = published.filter((a) => a.collection === collection);
    if (items.length > 0) entries.push({ url: absoluteUrl(`/${collection}`), lastModified: newest(items) });
  }
  for (const { slug: category } of await getCategories()) {
    if (await isCategoryIndexable(category, query)) {
      entries.push({ url: absoluteUrl(`/category/${category}`), lastModified: newest(await articlesInCategory(category, query)) });
    }
  }
  for (const author of await getAuthors()) {
    const items = published.filter((a) => a.frontmatter.author === author.slug);
    if (items.length > 0) entries.push({ url: absoluteUrl(author.path), lastModified: newest(items) });
  }
  for (const page of await getPages()) {
    entries.push({ url: absoluteUrl(page.path), ...(page.frontmatter.updatedAt ? { lastModified: page.frontmatter.updatedAt } : {}) });
  }
  for (const article of published.filter(isSelfCanonical)) {
    entries.push({ url: absoluteUrl(article.path), lastModified: lastModified(article) });
  }
  return entries;
}
