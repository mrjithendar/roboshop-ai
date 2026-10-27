import { getCategoryMap, labelOf } from "@/lib/categories";
import { getPublishedContent } from "@/lib/content";
import { buildSearchIndex } from "@/lib/seo/search-index";

export const dynamic = "force-dynamic";

export async function GET() {
  const cats = await getCategoryMap();
  return Response.json(buildSearchIndex(await getPublishedContent(), (s) => labelOf(cats, s)), {
    headers: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" },
  });
}
