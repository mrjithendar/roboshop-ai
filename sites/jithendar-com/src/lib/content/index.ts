import { isContentPreview } from "@/config/site";
import { broadcastInvalidate, onInvalidate } from "@/lib/cache-bus";
import { getCategoryMap } from "@/lib/categories";
import {
  MIN_INDEXABLE_TAXONOMY_ITEMS,
  PAGE_SIZE,
  relatedCategories,
  tagSlug,
  type Category,
  type Collection,
} from "@/config/taxonomy";
import { loadContentFromDb } from "./db-source";
import { contentRoot, loadContent, type Article, type Author, type ContentStore, type Page } from "./load";

export type { Article, Author, Page } from "./load";

type Cached = { store: ContentStore; at: number };
const cache = new Map<string, Cached>();
const DB_TTL_MS = 30_000;

/**
 * Content comes from Postgres, or from MDX files when a root is given / CONTENT_DIR is set
 * (tests, and the one-time import). The DB copy is cached briefly per process; writes call
 * invalidateContent() so the editing replica sees changes immediately.
 */
async function store(root?: string): Promise<ContentStore> {
  const fileRoot = root ?? process.env.CONTENT_DIR;
  const key = fileRoot ? `files:${fileRoot}` : "db";
  const hit = cache.get(key);
  const fresh = hit && (fileRoot ? process.env.NODE_ENV !== "development" : Date.now() - hit.at < DB_TTL_MS);
  if (hit && fresh) return hit.store;
  let loaded = fileRoot ? loadContent(fileRoot) : await loadContentFromDb();
  // Fresh installation (nothing imported yet): serve the bundled content so pages work before /setup.
  if (!fileRoot && loaded.articles.length === 0 && loaded.pages.size === 0 && loaded.authors.size === 0) {
    loaded = loadContent(contentRoot());
  }
  cache.set(key, { store: loaded, at: Date.now() });
  return loaded;
}

onInvalidate("content", () => cache.delete("db"));

/** Clear the content cache here and on every other replica (via Redis when configured). */
export function invalidateContent() {
  broadcastInvalidate("content");
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
export async function getPublishedContent({ collection, now = new Date(), root, preview = isContentPreview() }: PublishedQuery = {}): Promise<Article[]> {
  const cutoff = now.getTime();
  return (await store(root)).articles.filter((a) => collection === undefined || a.collection === collection)
    .flatMap((a) => {
      const fm = a.frontmatter;
      if (fm.status === "published" && fm.publishedAt !== undefined && Date.parse(fm.publishedAt) <= cutoff) return [a];
      if (preview && fm.status === "review") return [previewCopy(a, now)];
      return [];
    })
    .sort((a, b) => Date.parse(b.frontmatter.publishedAt!) - Date.parse(a.frontmatter.publishedAt!) || a.slug.localeCompare(b.slug));
}

export async function getPublishedArticle(collection: Collection, slug: string, query: Omit<PublishedQuery, "collection"> = {}) {
  return (await getPublishedContent({ ...query, collection })).find((a) => a.slug === slug);
}

export async function getAuthor(slug: string, root?: string): Promise<Author | undefined> {
  return (await store(root)).authors.get(slug);
}

export async function getAuthors(root?: string): Promise<Author[]> {
  return [...(await store(root)).authors.values()];
}

export async function getPage(slug: string, root?: string): Promise<Page | undefined> {
  return (await store(root)).pages.get(slug);
}

export async function getPages(root?: string): Promise<Page[]> {
  return [...(await store(root)).pages.values()];
}

/** Last substantive change of an article (updatedAt, else publishedAt). */
export function lastModified(article: Article): string {
  return article.frontmatter.updatedAt ?? article.frontmatter.publishedAt!;
}

// --- Taxonomy -------------------------------------------------------------

export async function articlesInCategory(category: Category, query: PublishedQuery = {}): Promise<Article[]> {
  return (await getPublishedContent(query)).filter((a) => a.frontmatter.category === category);
}

/** Published tags as { slug, label, count }, most used first. */
export async function publishedTags(query: PublishedQuery = {}) {
  const tags = new Map<string, { slug: string; label: string; count: number }>();
  for (const a of await getPublishedContent(query)) {
    for (const label of a.frontmatter.tags) {
      const slug = tagSlug(label);
      const entry = tags.get(slug) ?? { slug, label, count: 0 };
      entry.count += 1;
      tags.set(slug, entry);
    }
  }
  return [...tags.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

export async function articlesWithTag(slug: string, query: PublishedQuery = {}): Promise<Article[]> {
  return (await getPublishedContent(query)).filter((a) => a.frontmatter.tags.some((t) => tagSlug(t) === slug));
}

/** Thin-content rule: a taxonomy page is indexable only with enough items and its own intro text. */
export function isTaxonomyIndexable(itemCount: number, intro: string | undefined): boolean {
  return itemCount >= MIN_INDEXABLE_TAXONOMY_ITEMS && Boolean(intro?.trim());
}

export async function isCategoryIndexable(category: Category, query: PublishedQuery = {}): Promise<boolean> {
  const intro = (await getCategoryMap()).get(category)?.intro;
  return isTaxonomyIndexable((await articlesInCategory(category, query)).length, intro);
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
export async function relatedArticles(article: Article, limit = 3, query: PublishedQuery = {}): Promise<Article[]> {
  const fm = article.frontmatter;
  const candidates = (await getPublishedContent(query)).filter((a) => a.path !== article.path);
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
