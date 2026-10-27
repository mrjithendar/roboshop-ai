import { notFound } from "next/navigation";
import { site } from "@/config/site";
import { categories, categoryIntros, categoryKeys } from "@/config/taxonomy";
import { articlesInCategory } from "@/lib/content";
import { isCategory } from "@/lib/pages/listings";
import { buildRss, rssResponse } from "@/lib/seo/feed";

type Props = { params: Promise<{ category: string }> };

export const revalidate = 300;
export const dynamicParams = false;

export const generateStaticParams = () => categoryKeys.map((category) => ({ category }));

export async function GET(_request: Request, { params }: Props) {
  const { category } = await params;
  if (!isCategory(category)) notFound();
  return rssResponse(
    buildRss({
      title: `${categories[category]} | ${site.name}`,
      description: categoryIntros[category],
      path: `/category/${category}`,
      selfPath: `/category/${category}/feed.xml`,
      articles: articlesInCategory(category),
    }),
  );
}
