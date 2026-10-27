import { absoluteUrl } from "@/config/site";
import type { Article } from "@/lib/content";

/** Absolute canonical URL: the frontmatter override if set, else the article's own URL. */
export function canonicalFor(article: Article): string {
  return article.frontmatter.canonicalUrl ?? absoluteUrl(article.path);
}

/** True when the article's canonical is this site's own URL (only those belong in our sitemaps). */
export function isSelfCanonical(article: Article): boolean {
  return canonicalFor(article) === absoluteUrl(article.path);
}
