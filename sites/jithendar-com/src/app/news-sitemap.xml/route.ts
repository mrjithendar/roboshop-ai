import { getPublishedContent } from "@/lib/content";
import { buildNewsSitemap, newsSitemapEntries } from "@/lib/seo/news-sitemap";

// Evaluated per request so articles age out of the 48-hour window without a rebuild.
export const dynamic = "force-dynamic";

export function GET() {
  const now = new Date();
  const xml = buildNewsSitemap(newsSitemapEntries(getPublishedContent({ now }), now));
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
