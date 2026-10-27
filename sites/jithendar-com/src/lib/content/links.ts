import { collections, tagSlug } from "@/config/taxonomy";
import { getCategories } from "@/lib/categories";
import { checkImage, imageRefs, publicRoot, type ImageProblem } from "@/lib/images";
import { getAuthors, getPages, getPublishedContent, type PublishedQuery } from "./index";
import { contentRoot, loadContent } from "./load";

const STATIC_ROUTES = ["/", "/search", "/feed.xml", "/sitemap.xml", "/news-sitemap.xml", "/robots.txt", ...collections.map((c) => `/${c}`)];

/** Internal links in a body: markdown `[text](/path)` (not images: `![alt](…)` is checked by the image checker) and `href="/path"`, without query or fragment. */
export function internalLinks(body: string): string[] {
  const found = new Set<string>();
  const patterns = [/(?<!!)\[[^\]]*\]\((\/[^)\s]*)/g, /href=["'](\/[^"']*)["']/g];
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
export async function publicRoutes(query: PublishedQuery = {}): Promise<Set<string>> {
  const published = await getPublishedContent({ ...query, preview: false });
  const routes = new Set(STATIC_ROUTES);
  for (const a of published) {
    routes.add(a.path);
    for (const t of a.frontmatter.tags) routes.add(`/tag/${tagSlug(t)}`);
  }
  for (const { slug: c } of await getCategories()) {
    routes.add(`/category/${c}`);
    routes.add(`/category/${c}/feed.xml`);
  }
  for (const a of await getAuthors(query.root)) routes.add(a.path);
  for (const p of await getPages(query.root)) routes.add(p.path);
  return routes;
}

export type BrokenLink = { file: string; link: string };

/**
 * Published articles, pages and author bios may link only to public routes.
 * Unpublished drafts may also link to other existing (not yet published) content.
 */
export async function findBrokenLinks(query: PublishedQuery = {}): Promise<BrokenLink[]> {
  const root = query.root ?? contentRoot();
  const store = loadContent(root);
  const routes = await publicRoutes({ ...query, root });
  const published = new Set((await getPublishedContent({ ...query, root, preview: false })).map((a) => a.path));
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

/**
 * Every image in content (articles of any status, pages, author bios, featured images) must be a local
 * /images/... file that exists, is under the size limit and has alt text. `npm test` fails otherwise.
 */
export function findImageProblems(query: PublishedQuery = {}, publicDir: string = publicRoot()): ImageProblem[] {
  const store = loadContent(query.root ?? contentRoot());
  const problems: ImageProblem[] = [];
  const bodies = [...store.articles, ...store.pages.values(), ...store.authors.values()];
  for (const item of bodies) {
    for (const ref of imageRefs(item.body)) problems.push(...checkImage(item.file, ref, publicDir));
  }
  for (const a of store.articles) {
    const featured = a.frontmatter.featuredImage;
    if (featured) problems.push(...checkImage(a.file, { src: featured.src, alt: featured.alt }, publicDir));
  }
  return problems;
}
