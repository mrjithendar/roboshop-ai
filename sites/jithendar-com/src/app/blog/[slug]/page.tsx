import { articleMetadata, ArticlePage, articleStaticParams, type SlugParams } from "@/lib/pages/article";

// Scheduled items appear on their first request after publishedAt; drafts never render.
export const revalidate = 300;

export const generateStaticParams = () => articleStaticParams("blog");

export const generateMetadata = (props: SlugParams) => articleMetadata("blog", props);

export default function Page(props: SlugParams) {
  return <ArticlePage collection="blog" {...props} />;
}
