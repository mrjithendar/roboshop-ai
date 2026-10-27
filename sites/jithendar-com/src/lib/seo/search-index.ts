import { contentTypes } from "@/config/taxonomy";
import type { Article } from "@/lib/content";

export type SearchEntry = {
  title: string;
  description: string;
  path: string;
  type: string;
  category: string;
  tags: string[];
  publishedAt: string;
};

/** Search index entries; callers pass getPublishedContent output, so drafts never reach the client. */
export function buildSearchIndex(articles: Article[], categoryLabel: (slug: string) => string = (s) => s): SearchEntry[] {
  return articles.map((a) => ({
    title: a.frontmatter.title,
    description: a.frontmatter.description,
    path: a.path,
    type: contentTypes[a.frontmatter.contentType],
    category: categoryLabel(a.frontmatter.category),
    tags: a.frontmatter.tags,
    publishedAt: a.frontmatter.publishedAt!,
  }));
}

/** Every query term must match; title hits rank above tag/category hits, which rank above description hits. */
export function searchEntries(index: SearchEntry[], query: string, limit = 20): SearchEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return index
    .map((entry) => {
      const title = entry.title.toLowerCase();
      const meta = [entry.category, entry.type, ...entry.tags].join(" ").toLowerCase();
      const body = entry.description.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 3;
        else if (meta.includes(term)) score += 2;
        else if (body.includes(term)) score += 1;
        else return { entry, score: 0 };
      }
      return { entry, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.publishedAt.localeCompare(a.entry.publishedAt))
    .slice(0, limit)
    .map((r) => r.entry);
}
