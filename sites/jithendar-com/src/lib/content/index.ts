import { isContentPreview } from "@/config/site";
import {
  categoryIntros,
  MIN_INDEXABLE_TAXONOMY_ITEMS,
  PAGE_SIZE,
  relatedCategories,
  tagSlug,
  type Category,
  type Collection,
} from "@/config/taxonomy";
import { contentRoot, loadContent, type Article, type Author, type ContentStore, type Page } from "./load";

export type { Article, Author, Page } from "./load";

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

export type PublishedQuery = { collection?: Collection; now?: Date; root?: string; preview?: boolean };

/** Preview shows review items as if published now; it is forced off in production (isContentPreview). */
function previewCopy(article: Article, now: Date): Article {
  const publishedAt = article.frontmatter.publishedAt ?? now.toISOString();
  return { ...article, preview: true, frontmatter: { ...article.frontmatter, publishedAt } };
}

/**
 * The only way pages, sitemaps, feeds, search and related lists may read articles.
 * Returns status "published" items whose publishedAt is not in the future, newest first.
 */
export function getPublishedContent({ collection, now = new Date(), root, preview = isContentPreview() }: PublishedQuery = {}): Article[] {
  const cutoff = now.getTime();
  return store(root)
    .articles.filter((a) => collection === undefined || a.collection === collection)
    .flatMap((a) => {
      const fm = a.frontmatter;
      if (fm.status === "published" && fm.publishedAt !== undefined && Date.parse(fm.publishedAt) <= cutoff) return [a];
      if (preview && fm.status === "review") return [previewCopy(a, now)];
      return [];
    })
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

export function getPage(slug: string, root?: string): Page | undefined {
  return store(root).pages.get(slug);
}

export function getPages(root?: string): Page[] {
  return [...store(root).pages.values()];
}

/** Last substantive change of an article (updatedAt, else publishedAt). */
export function lastModified(article: Article): string {
  return article.frontmatter.updatedAt ?? article.frontmatter.publishedAt!;
}

// --- Taxonomy -------------------------------------------------------------

export function articlesInCategory(category: Category, query: PublishedQuery = {}): Article[] {
  return getPublishedContent(query).filter((a) => a.frontmatter.category === category);
}

/** Published tags as { slug, label, count }, most used first. */
export function publishedTags(query: PublishedQuery = {}) {
  const tags = new Map<string, { slug: string; label: string; count: number }>();
  for (const a of getPublishedContent(query)) {
    for (const label of a.frontmatter.tags) {
      const slug = tagSlug(label);
      const entry = tags.get(slug) ?? { slug, label, count: 0 };
      entry.count += 1;
      tags.set(slug, entry);
    }
  }
  return [...tags.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

export function articlesWithTag(slug: string, query: PublishedQuery = {}): Article[] {
  return getPublishedContent(query).filter((a) => a.frontmatter.tags.some((t) => tagSlug(t) === slug));
}

/** Thin-content rule: a taxonomy page is indexable only with enough items and its own intro text. */
export function isTaxonomyIndexable(itemCount: number, intro: string | undefined): boolean {
  return itemCount >= MIN_INDEXABLE_TAXONOMY_ITEMS && Boolean(intro?.trim());
}

export function isCategoryIndexable(category: Category, query: PublishedQuery = {}): boolean {
  return isTaxonomyIndexable(articlesInCategory(category, query).length, categoryIntros[category]);
}

// --- Pagination -----------------------------------------------------------

export type Paged<T> = { items: T[]; page: number; totalPages: number };

/** 1-based page of a list; undefined when the page does not exist (page 1 always exists). */
export function paginate<T>(items: T[], page: number, size: number = PAGE_SIZE): Paged<T> | undefined {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return undefined;
  return { items: items.slice((page - 1) * size, page * size), page, totalPages };
}

/** Parse a /page/<n> route segment; only canonical integers ≥ 2 are valid (page 1 is the base URL). */
export function parsePageParam(value: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(value)) return undefined;
  const page = Number(value);
  return page >= 2 ? page : undefined;
}

// --- Related articles -----------------------------------------------------

const relatedPairs = new Set(relatedCategories.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/**
 * Deterministic related list: explicit `related` refs first, then a score of
 * shared category (3), related category (1) and shared tags (2 each). Ties: newest, then slug.
 */
export function relatedArticles(article: Article, limit = 3, query: PublishedQuery = {}): Article[] {
  const fm = article.frontmatter;
  const candidates = getPublishedContent(query).filter((a) => a.path !== article.path);
  const explicit = fm.related.flatMap((ref) => candidates.filter((a) => `${a.collection}/${a.slug}` === ref));
  const tags = new Set(fm.tags);

  const scored = candidates
    .filter((a) => !explicit.includes(a))
    .map((a) => {
      let score = 0;
      if (a.frontmatter.category === fm.category) score += 3;
      else if (relatedPairs.has(`${fm.category}|${a.frontmatter.category}`)) score += 1;
      score += 2 * a.frontmatter.tags.filter((t) => tags.has(t)).length;
      return { a, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (x, y) =>
        y.score - x.score ||
        Date.parse(y.a.frontmatter.publishedAt!) - Date.parse(x.a.frontmatter.publishedAt!) ||
        x.a.path.localeCompare(y.a.path),
    )
    .map(({ a }) => a);

  return [...explicit, ...scored].slice(0, limit);
}

// --- Reading time ---------------------------------------------------------

/** Minutes at 220 words per minute, ignoring code fences and MDX/HTML tags; at least 1. */
export function readingTimeMinutes(body: string): number {
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`[\]()!-]/g, " ");
  const words = prose.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
