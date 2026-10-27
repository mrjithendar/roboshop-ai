import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard } from "@/components/ArticleList";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentTypeBadge, PreviewBadge, SponsoredBadge } from "@/components/ContentTypeBadge";
import { JsonLd } from "@/components/JsonLd";
import { mdxComponents } from "@/components/Mdx";
import { TableOfContents } from "@/components/TableOfContents";
import { TagList } from "@/components/TagList";
import { absoluteUrl, site } from "@/config/site";
import { categories, collectionLabels, type Collection } from "@/config/taxonomy";
import { getAuthor, getPublishedArticle, getPublishedContent, readingTimeMinutes, relatedArticles } from "@/lib/content";
import { formatDateTime } from "@/lib/dates";
import { compileMdx } from "@/lib/mdx/compile";
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
    ...(article.preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export async function ArticlePage({ collection, params }: { collection: Collection } & SlugParams) {
  const { slug } = await params;
  const { article, author } = load(collection, slug);
  const fm = article.frontmatter;
  const { Content, headings } = await compileMdx(article.body);
  const related = relatedArticles(article);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: collectionLabels[collection], path: `/${collection}` },
    { name: fm.title, path: article.path },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <article>
        <JsonLd data={[articleLd(article, author), breadcrumbLd(crumbs)]} />
        <Breadcrumbs crumbs={crumbs} />
        <header className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <ContentTypeBadge type={fm.contentType} />
            {fm.sponsored && <SponsoredBadge />}
            {article.preview && <PreviewBadge />}
            <Link href={`/category/${fm.category}`} className="text-sm text-zinc-700 hover:underline dark:text-zinc-300">
              {categories[fm.category]}
            </Link>
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{fm.title}</h1>
          <p className="mt-3 text-lg text-zinc-700 dark:text-zinc-300">{fm.description}</p>
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            By{" "}
            <Link href={author.path} rel="author" className="font-medium text-zinc-900 underline dark:text-zinc-100">
              {author.frontmatter.name}
            </Link>
            {" · "}Published <time dateTime={fm.publishedAt}>{formatDateTime(fm.publishedAt!)}</time>
            {fm.updatedAt && (
              <>
                {" · "}Updated <time dateTime={fm.updatedAt}>{formatDateTime(fm.updatedAt)}</time>
              </>
            )}
            {" · "}
            {readingTimeMinutes(article.body)} min read
          </p>
          {fm.sponsored && fm.sponsor && (
            <p className="mt-3 rounded border border-yellow-500 bg-yellow-50 p-3 text-sm text-yellow-950 dark:bg-yellow-950 dark:text-yellow-100">
              Sponsored by {fm.sponsor}. See the{" "}
              <Link href="/editorial-policy" className="underline">
                editorial policy
              </Link>{" "}
              for how sponsored content is handled.
            </p>
          )}
          {fm.contentType === "curated" && (
            <p className="mt-3 rounded border border-sky-400 bg-sky-50 p-3 text-sm text-sky-950 dark:bg-sky-950 dark:text-sky-100">
              Curated summary: this piece summarises the sources listed at the end. Read them for full detail.
            </p>
          )}
        </header>

        {fm.featuredImage && (
          <Image
            src={fm.featuredImage.src}
            alt={fm.featuredImage.alt}
            width={fm.featuredImage.width}
            height={fm.featuredImage.height}
            priority
            className="mt-8 h-auto w-full rounded-lg"
          />
        )}

        <div className="mt-8">
          <TableOfContents headings={headings} />
        </div>

        <div className="prose prose-zinc mt-8 max-w-none dark:prose-invert prose-pre:my-0 prose-headings:scroll-mt-6">
          <Content components={mdxComponents} />
        </div>

        {fm.sources.length > 0 && (
          <section aria-labelledby="sources" className="mt-12">
            <h2 id="sources" className="text-xl font-semibold">
              Sources
            </h2>
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
            <h2 id="corrections" className="text-xl font-semibold">
              Corrections
            </h2>
            <ul className="mt-3 space-y-2">
              {fm.corrections.map((c) => (
                <li key={c.date}>
                  <time dateTime={c.date}>{formatDateTime(c.date)}</time>: {c.note}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              <Link href="/corrections-policy" className="underline">
                How corrections work
              </Link>
            </p>
          </section>
        )}

        <footer className="mt-12">
          <TagList tags={fm.tags} />
        </footer>
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-16">
          <h2 id="related" className="text-xl font-semibold">
            Related reading
          </h2>
          <ul className="mt-4 grid gap-4">
            {related.map((a) => (
              <li key={a.path} className="flex">
                <ArticleCard article={a} headingLevel={3} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
