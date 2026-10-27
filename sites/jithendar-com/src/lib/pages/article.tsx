import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { Mdx } from "@/components/Mdx";
import { absoluteUrl, site } from "@/config/site";
import { categories, collectionLabels, contentTypes, type Collection } from "@/config/taxonomy";
import { getAuthor, getPublishedArticle, getPublishedContent } from "@/lib/content";
import { formatDateTime } from "@/lib/dates";
import { canonicalFor } from "@/lib/seo/canonical";
import { articleLd, breadcrumbLd } from "@/lib/seo/jsonld";

export type SlugParams = { params: Promise<{ slug: string }> };

export function articleStaticParams(collection: Collection) {
  return getPublishedContent({ collection }).map((a) => ({ slug: a.slug }));
}

function load(collection: Collection, slug: string) {
  const article = getPublishedArticle(collection, slug);
  if (!article) notFound();
  const author = getAuthor(article.frontmatter.author);
  if (!author) notFound();
  return { article, author };
}

export async function articleMetadata(collection: Collection, { params }: SlugParams): Promise<Metadata> {
  const { slug } = await params;
  const { article, author } = load(collection, slug);
  const fm = article.frontmatter;
  const canonical = canonicalFor(article);
  const images = fm.featuredImage
    ? [{ url: absoluteUrl(fm.featuredImage.src), width: fm.featuredImage.width, height: fm.featuredImage.height, alt: fm.featuredImage.alt }]
    : undefined;
  return {
    title: fm.title,
    description: fm.description,
    alternates: { canonical },
    authors: [{ name: author.frontmatter.name, url: absoluteUrl(author.path) }],
    openGraph: {
      type: "article",
      url: canonical,
      siteName: site.name,
      locale: site.locale,
      title: fm.title,
      description: fm.description,
      publishedTime: fm.publishedAt,
      modifiedTime: fm.updatedAt,
      authors: [absoluteUrl(author.path)],
      section: categories[fm.category],
      tags: fm.tags,
      images,
    },
    twitter: { card: images ? "summary_large_image" : "summary", title: fm.title, description: fm.description },
  };
}

export async function ArticlePage({ collection, params }: { collection: Collection } & SlugParams) {
  const { slug } = await params;
  const { article, author } = load(collection, slug);
  const fm = article.frontmatter;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: collectionLabels[collection], path: `/${collection}` },
    { name: fm.title, path: article.path },
  ];

  return (
    <article>
      <JsonLd data={[articleLd(article, author), breadcrumbLd(crumbs)]} />
      <Breadcrumbs crumbs={crumbs} />
      <header className="mt-6">
        <p className="flex flex-wrap gap-2 text-xs font-medium uppercase tracking-wide">
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
            {contentTypes[fm.contentType]}
          </span>
          {fm.sponsored && <span className="rounded bg-amber-200 px-2 py-0.5 text-amber-950">Sponsored</span>}
          <span className="py-0.5 text-zinc-600 dark:text-zinc-400">{categories[fm.category]}</span>
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{fm.title}</h1>
        <p className="mt-3 text-lg text-zinc-700 dark:text-zinc-300">{fm.description}</p>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          By{" "}
          <Link href={author.path} rel="author" className="font-medium underline">
            {author.frontmatter.name}
          </Link>{" "}
          · Published <time dateTime={fm.publishedAt}>{formatDateTime(fm.publishedAt!)}</time>
          {fm.updatedAt && (
            <>
              {" "}
              · Updated <time dateTime={fm.updatedAt}>{formatDateTime(fm.updatedAt)}</time>
            </>
          )}
        </p>
        {fm.sponsored && fm.sponsor && <p className="mt-2 text-sm">Sponsored by {fm.sponsor}.</p>}
      </header>

      {fm.featuredImage && (
        <Image
          src={fm.featuredImage.src}
          alt={fm.featuredImage.alt}
          width={fm.featuredImage.width}
          height={fm.featuredImage.height}
          priority
          className="mt-8 h-auto w-full rounded"
        />
      )}

      <div className="prose prose-zinc mt-8 max-w-none dark:prose-invert">
        <Mdx source={article.body} />
      </div>

      {fm.sources.length > 0 && (
        <section aria-labelledby="sources" className="mt-12">
          <h2 id="sources" className="text-xl font-semibold">Sources</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {fm.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} className="underline" rel="noopener">
                  {s.title}
                </a>{" "}
                — {s.publisher}
              </li>
            ))}
          </ul>
        </section>
      )}

      {fm.corrections.length > 0 && (
        <section aria-labelledby="corrections" className="mt-12">
          <h2 id="corrections" className="text-xl font-semibold">Corrections</h2>
          <ul className="mt-3 space-y-2">
            {fm.corrections.map((c) => (
              <li key={c.date}>
                <time dateTime={c.date}>{formatDateTime(c.date)}</time>: {c.note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
