import type { Collection } from "@/config/taxonomy";
import { contentRoot, loadContent, type Article, type Author, type ContentStore } from "./load";

export type { Article, Author } from "./load";

const cache = new Map<string, ContentStore>();

/** Content is immutable per build, so it is read once per process (re-read on every call in dev). */
function store(root: string = contentRoot()): ContentStore {
  if (process.env.NODE_ENV === "development") return loadContent(root);
  let cached = cache.get(root);
  if (!cached) {
    cached = loadContent(root);
    cache.set(root, cached);
  }
  return cached;
}

export type PublishedQuery = { collection?: Collection; now?: Date; root?: string };

/**
 * The only way pages, sitemaps, feeds, search and related lists may read articles.
 * Returns status "published" items whose publishedAt is not in the future, newest first.
 */
export function getPublishedContent({ collection, now = new Date(), root }: PublishedQuery = {}): Article[] {
  const cutoff = now.getTime();
  return store(root)
    .articles.filter(
      (a) =>
        a.frontmatter.status === "published" &&
        a.frontmatter.publishedAt !== undefined &&
        Date.parse(a.frontmatter.publishedAt) <= cutoff &&
        (collection === undefined || a.collection === collection),
    )
    .sort((a, b) => Date.parse(b.frontmatter.publishedAt!) - Date.parse(a.frontmatter.publishedAt!) || a.slug.localeCompare(b.slug));
}

export function getPublishedArticle(collection: Collection, slug: string, query: Omit<PublishedQuery, "collection"> = {}) {
  return getPublishedContent({ ...query, collection }).find((a) => a.slug === slug);
}

export function getAuthor(slug: string, root?: string): Author | undefined {
  return store(root).authors.get(slug);
}

export function getAuthors(root?: string): Author[] {
  return [...store(root).authors.values()];
}

/** Last substantive change of an article (updatedAt, else publishedAt). */
export function lastModified(article: Article): string {
  return article.frontmatter.updatedAt ?? article.frontmatter.publishedAt!;
}
