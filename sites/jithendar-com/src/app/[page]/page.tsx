import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { mdxComponents } from "@/components/Mdx";
import { absoluteUrl, site } from "@/config/site";
import { getPage, getPages } from "@/lib/content";
import { formatDate } from "@/lib/dates";
import { compileMdx } from "@/lib/mdx/compile";
import { breadcrumbLd } from "@/lib/seo/jsonld";

type Props = { params: Promise<{ page: string }> };

// Only pages in content/pages/ exist; everything else at this level is a 404.
export const dynamicParams = false;

export const generateStaticParams = () => getPages().map((p) => ({ page: p.slug }));

function load(slug: string) {
  const page = getPage(slug);
  if (!page) notFound();
  return page;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { frontmatter: fm, path } = load((await params).page);
  return {
    title: fm.title,
    description: fm.description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { type: "website", url: absoluteUrl(path), siteName: site.name, locale: site.locale, title: fm.title, description: fm.description },
  };
}

export default async function StaticPage({ params }: Props) {
  const page = load((await params).page);
  const fm = page.frontmatter;
  const { Content } = await compileMdx(page.body);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: fm.title, path: page.path },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{fm.title}</h1>
      {fm.updatedAt && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Last updated <time dateTime={fm.updatedAt}>{formatDate(fm.updatedAt)}</time>
        </p>
      )}
      <div className="prose prose-zinc mt-8 max-w-none dark:prose-invert">
        <Content components={mdxComponents} />
      </div>
    </div>
  );
}
