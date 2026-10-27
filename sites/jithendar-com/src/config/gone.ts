/**
 * URLs created on the hijacked WordPress install (2026-10-27, SEO_AUDIT AUD-002).
 * They answer 410 Gone so search engines drop them; never redirect them to real content.
 * Paths are listed without a trailing slash; the proxy normalizes before matching.
 */
export const gonePaths: ReadonlySet<string> = new Set([
  "/2026/10/27/hello-world",
  "/2026/10/27/0x1a0441f4",
  "/2026/10/27/acronis-true-image-advanced-crack-license-intel-amd-full-version-mega",
  "/2026/10/27/fatekeeper-tiny-girl-repack-for-desktop-2026",
  "/2026/10/27/astera-data-warehouse-builder-portable-license-latest-activated-mediafire",
  "/2026/10/27/wild-horse-nine-2026-1080p-mkv-clean-audio",
  "/sample-page",
  "/category/cracks",
  "/category/keygen",
  "/category/webdl",
  "/category/uncategorized",
  "/tag/0x1a0441f4",
  "/author/tezt",
  "/wp-sitemap.xml",
  "/wp-sitemap-posts-post-1.xml",
  "/wp-sitemap-posts-page-1.xml",
  "/wp-sitemap-taxonomies-category-1.xml",
  "/wp-sitemap-taxonomies-post_tag-1.xml",
  "/wp-sitemap-users-1.xml",
  "/feed",
  "/comments/feed",
]);

export function isGone(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return gonePaths.has(normalized);
}
