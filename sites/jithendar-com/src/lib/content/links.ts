import { categoryKeys, collections, tagSlug } from "@/config/taxonomy";
import { getAuthors, getPages, getPublishedContent, type PublishedQuery } from "./index";
import { contentRoot, loadContent } from "./load";

const STATIC_ROUTES = ["/", "/search", "/feed.xml", "/sitemap.xml", "/news-sitemap.xml", "/robots.txt", ...collections.map((c) => `/${c}`)];

/** Internal links in an MDX body: markdown `](/path)` and JSX/HTML `href="/path"`, without query or fragment. */
export function internalLinks(body: string): string[] {
  const found = new Set<string>();
  const patterns = [/\]\((\/[^)\s]*)/g, /href=["'](\/[^"']*)["']/g];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const raw = match[1] ?? "";
      if (raw.startsWith("//")) continue;
      const path = raw.split(/[?#]/)[0]!.replace(/(.)\/+$/, "$1");
      found.add(path || "/");
    }
  }
  return [...found];
}

/** Every route a reader can reach right now. */
export function publicRoutes(query: PublishedQuery = {}): Set<string> {
  const published = getPublishedContent({ ...query, preview: false });
  const routes = new Set(STATIC_ROUTES);
  for (const a of published) {
    routes.add(a.path);
    for (const t of a.frontmatter.tags) routes.add(`/tag/${tagSlug(t)}`);
  }
  for (const c of categoryKeys) {
    routes.add(`/category/${c}`);
    routes.add(`/category/${c}/feed.xml`);
  }
  for (const a of getAuthors(query.root)) routes.add(a.path);
  for (const p of getPages(query.root)) routes.add(p.path);
  return routes;
}

export type BrokenLink = { file: string; link: string };

/**
 * Published articles, pages and author bios may link only to public routes.
 * Unpublished drafts may also link to other existing (not yet published) content.
 */
export function findBrokenLinks(query: PublishedQuery = {}): BrokenLink[] {
  const root = query.root ?? contentRoot();
  const store = loadContent(root);
  const routes = publicRoutes({ ...query, root });
  const published = new Set(getPublishedContent({ ...query, root, preview: false }).map((a) => a.path));
  const existing = new Set(store.articles.map((a) => a.path));

  const broken: BrokenLink[] = [];
  const check = (file: string, body: string, allowUnpublished: boolean) => {
    for (const link of internalLinks(body)) {
      if (routes.has(link) || (allowUnpublished && existing.has(link))) continue;
      broken.push({ file, link });
    }
  };
  for (const a of store.articles) check(a.file, a.body, !published.has(a.path));
  for (const p of store.pages.values()) check(p.file, p.body, false);
  for (const a of store.authors.values()) check(a.file, a.body, false);
  return broken;
}
