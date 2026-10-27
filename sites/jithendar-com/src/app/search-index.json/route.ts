import { getPublishedContent } from "@/lib/content";
import { buildSearchIndex } from "@/lib/seo/search-index";

export const revalidate = 300;

export function GET() {
  return Response.json(buildSearchIndex(getPublishedContent()), {
    headers: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" },
  });
}
