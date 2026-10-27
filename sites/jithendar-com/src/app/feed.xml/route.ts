import { site } from "@/config/site";
import { getPublishedContent } from "@/lib/content";
import { buildRss, rssResponse } from "@/lib/seo/feed";

export const revalidate = 300;

export function GET() {
  return rssResponse(
    buildRss({ title: site.name, description: site.description, path: "/", selfPath: "/feed.xml", articles: getPublishedContent() }),
  );
}
