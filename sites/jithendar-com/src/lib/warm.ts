import { getCategories } from "./categories";
import { getPages, getPublishedContent } from "./content";
import { log } from "./log";
import { compileMdx } from "./mdx/compile";
import { getSettings } from "./settings";

/** Load content/settings/categories and pre-compile every published body (and start Shiki) once. */
export async function warmCaches() {
  const started = Date.now();
  const [articles, pages] = await Promise.all([getPublishedContent(), getPages(), getSettings(), getCategories()]);
  for (const body of [...articles.map((a) => a.body), ...pages.map((p) => p.body)]) await compileMdx(body);
  log.info("caches warmed", { articles: articles.length, pages: pages.length, ms: Date.now() - started });
}
