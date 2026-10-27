import { site } from "@/config/site";
import { getCategoryMap, labelOf } from "@/lib/categories";
import { getPublishedContent } from "@/lib/content";
import { buildRss, rssResponse } from "@/lib/seo/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const cats = await getCategoryMap();
  return rssResponse(
    buildRss({ title: site.name, description: site.description, path: "/", selfPath: "/feed.xml", articles: await getPublishedContent(), categoryLabel: (s) => labelOf(cats, s) }),
  );
}
