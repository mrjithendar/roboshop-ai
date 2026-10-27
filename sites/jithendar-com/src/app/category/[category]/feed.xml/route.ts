import { notFound } from "next/navigation";
import { site } from "@/config/site";
import { getCategoryMap, labelOf } from "@/lib/categories";
import { articlesInCategory } from "@/lib/content";
import { buildRss, rssResponse } from "@/lib/seo/feed";

type Props = { params: Promise<{ category: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: Props) {
  const { category } = await params;
  const cats = await getCategoryMap();
  const info = cats.get(category);
  if (!info) notFound();
  return rssResponse(
    buildRss({
      title: `${info.label} | ${site.name}`,
      description: info.intro,
      path: `/category/${category}`,
      selfPath: `/category/${category}/feed.xml`,
      articles: await articlesInCategory(category),
      categoryLabel: (s) => labelOf(cats, s),
    }),
  );
}
