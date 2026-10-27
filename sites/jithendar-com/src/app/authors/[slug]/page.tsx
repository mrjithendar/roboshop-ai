import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleList } from "@/components/ArticleList";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { Mdx } from "@/components/Mdx";
import { absoluteUrl, site } from "@/config/site";
import { getAuthor, getAuthors, getPublishedContent } from "@/lib/content";
import { breadcrumbLd, profilePageLd } from "@/lib/seo/jsonld";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 300;
export const dynamicParams = false;

export const generateStaticParams = () => getAuthors().map((a) => ({ slug: a.slug }));

function load(slug: string) {
  const author = getAuthor(slug);
  if (!author) notFound();
  const articles = getPublishedContent().filter((a) => a.frontmatter.author === slug);
  return { author, articles };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, articles } = load((await params).slug);
  const name = author.frontmatter.name;
  const description = `Articles and projects by ${name} on ${site.name}.`;
  return {
    title: name,
    description,
    alternates: { canonical: absoluteUrl(author.path) },
    openGraph: { type: "profile", url: absoluteUrl(author.path), siteName: site.name, locale: site.locale, title: name, description },
    // An author page with no published work is thin content.
    ...(articles.length > 0 ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function AuthorPage({ params }: Props) {
  const { author, articles } = load((await params).slug);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: author.frontmatter.name, path: author.path },
  ];
  return (
    <>
      <JsonLd data={[profilePageLd(author), breadcrumbLd(crumbs)]} />
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{author.frontmatter.name}</h1>
      {author.frontmatter.jobTitle && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{author.frontmatter.jobTitle}</p>}
      {author.body.trim() && (
        <div className="prose prose-zinc mt-6 max-w-none dark:prose-invert">
          <Mdx source={author.body} />
        </div>
      )}
      <h2 className="mt-12 text-xl font-semibold">Published work</h2>
      <div className="mt-6">
        <ArticleList articles={articles} emptyText="Nothing published yet." />
      </div>
    </>
  );
}
