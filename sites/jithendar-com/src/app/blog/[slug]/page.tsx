import { articleMetadata, ArticlePage, type SlugParams } from "@/lib/pages/article";

// Rendered per request from Postgres; drafts and future items never render (getPublishedContent).
export const dynamic = "force-dynamic";

export const generateMetadata = (props: SlugParams) => articleMetadata("blog", props);

export default function Page(props: SlugParams) {
  return <ArticlePage collection="blog" {...props} />;
}
