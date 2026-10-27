import { contentTypes } from "@/config/taxonomy";
import { getCategoryMap, labelOf } from "@/lib/categories";
import { getPublishedArticle } from "@/lib/content";
import { ogCard, ogSize } from "@/lib/og/card";

export const alt = "Article preview";
export const size = ogSize;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const article = await getPublishedArticle("projects", (await params).slug);
  if (!article) return ogCard({ eyebrow: "Jithendar.com", title: "Engineering insight on AI, cloud and Kubernetes", footer: "jithendar.com" });
  const fm = article.frontmatter;
  return ogCard({ eyebrow: `${contentTypes[fm.contentType]} · ${labelOf(await getCategoryMap(), fm.category)}`, title: fm.title, footer: "jithendar.com" });
}
