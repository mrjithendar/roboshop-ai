import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArticleCard } from "@/components/ArticleList";
import { AuthorCard, Avatar } from "@/components/AuthorCard";
import { toneFor } from "@/components/categoryStyle";
import { Comments } from "@/components/Comments";
import { Container } from "@/components/Container";
import { CategoryIcon, ClockIcon } from "@/components/icons";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentTypeBadge, PreviewBadge, SponsoredBadge } from "@/components/ContentTypeBadge";
import { JsonLd } from "@/components/JsonLd";
import { mdxComponents } from "@/components/Mdx";
import { TableOfContents } from "@/components/TableOfContents";
import { TagList } from "@/components/TagList";
import { AdSlot } from "@/components/integrations/AdSlot";
import { ArticleEngagement } from "@/components/integrations/ThirdPartyClient";
import { integrations } from "@/config/integrations";
import { absoluteUrl, site } from "@/config/site";
import { collectionLabels, type Collection } from "@/config/taxonomy";
import { getCategoryMap, labelOf } from "@/lib/categories";
import { findRedirect } from "@/lib/redirects";
import { getAuthor, getPublishedArticle, readingTimeMinutes, relatedArticles, type Article, type Author } from "@/lib/content";
import { formatDateTime } from "@/lib/dates";
import { compileMdx } from "@/lib/mdx/compile";
import { canonicalFor } from "@/lib/seo/canonical";
import { articleLd, breadcrumbLd } from "@/lib/seo/jsonld";

export type SlugParams = { params: Promise<{ slug: string }> };

async function load(collection: Collection, slug: string) {
  const article = await getPublishedArticle(collection, slug);
  if (!article) {
    // A renamed slug keeps working: 308 to its new URL.
    const moved = await findRedirect(`/${collection}/${slug}`);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const author = await getAuthor(article.frontmatter.author);
  if (!author) notFound();
  return { article, author };
}

export async function articleMetadata(collection: Collection, { params }: SlugParams): Promise<Metadata> {
  const { slug } = await params;
  const { article, author } = await load(collection, slug);
  const fm = article.frontmatter;
  const canonical = canonicalFor(article);
  const cardImage = fm.socialImage ?? fm.featuredImage;
  const images = cardImage ? [{ url: absoluteUrl(cardImage.src), width: cardImage.width, height: cardImage.height, alt: cardImage.alt }] : undefined;
  // Search results use the SEO overrides; social cards prefer their own, then the SEO ones.
  const title = fm.seoTitle ?? fm.title;
  const description = fm.seoDescription ?? fm.description;
  const socialTitle = fm.socialTitle ?? title;
  const socialDescription = fm.socialDescription ?? description;
  return {
    title,
    description,
    alternates: { canonical },
    authors: [{ name: author.frontmatter.name, url: absoluteUrl(author.path) }],
    openGraph: {
      type: "article",
      url: canonical,
      siteName: site.name,
      locale: site.locale,
      title: socialTitle,
      description: socialDescription,
      publishedTime: fm.publishedAt,
      modifiedTime: fm.updatedAt,
      authors: [absoluteUrl(author.path)],
      section: labelOf(await getCategoryMap(), fm.category),
      tags: fm.tags,
      images,
    },
    twitter: { card: images ? "summary_large_image" : "summary", title: socialTitle, description: socialDescription },
    ...(article.preview ? { robots: { index: false, follow: false } } : fm.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export async function ArticlePage({ collection, params }: { collection: Collection } & SlugParams) {
  const { slug } = await params;
  const { article, author } = await load(collection, slug);
  return <ArticleView article={article} author={author} collection={collection} />;
}

/** The full article layout, shared by the public page and the editor preview. */
export async function ArticleView({
  article,
  author,
  collection,
  notice,
}: {
  article: Article;
  author: Author;
  collection: Collection;
  notice?: ReactNode;
}) {
  const fm = article.frontmatter;
  const { Content, headings } = await compileMdx(article.body);
  const related = await relatedArticles(article);
  const cats = await getCategoryMap();
  const category = cats.get(fm.category);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: collectionLabels[collection], path: `/${collection}` },
    { name: fm.title, path: article.path },
  ];
  const hasToc = headings.length >= 2;
  const ads = integrations().adsense;

  return (
    <article>
      {!article.preview && <JsonLd data={[articleLd(article, author), breadcrumbLd(crumbs)]} />}
      {notice}
      <header className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white dark:border-white/10 dark:from-white/[0.03] dark:to-transparent">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <Container className="relative py-12 sm:py-16">
          <div className="max-w-3xl">
            <Breadcrumbs crumbs={crumbs} />
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <ContentTypeBadge type={fm.contentType} />
              {fm.sponsored && <SponsoredBadge />}
              {article.preview && <PreviewBadge />}
              <Link
                href={`/category/${fm.category}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink dark:text-slate-300 dark:hover:text-white"
              >
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset ${toneFor(category?.tone ?? "slate")}`}>
                  <CategoryIcon name={category?.icon ?? "layers"} className="h-3.5 w-3.5" />
                </span>
                {labelOf(cats, fm.category)}
              </Link>
            </div>
            <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15] dark:text-white">
              {fm.title}
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600 sm:text-xl dark:text-slate-300">{fm.description}</p>
            <div className="mt-8 flex items-center gap-4">
              <Avatar name={author.frontmatter.name} />
              <div className="text-sm">
                <p className="font-semibold text-ink dark:text-white">
                  <Link href={author.path} rel="author" className="hover:underline">
                    {author.frontmatter.name}
                  </Link>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-slate-500 dark:text-slate-400">
                  <span>
                    Published <time dateTime={fm.publishedAt}>{formatDateTime(fm.publishedAt!)}</time>
                  </span>
                  {fm.updatedAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Updated <time dateTime={fm.updatedAt}>{formatDateTime(fm.updatedAt)}</time>
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon className="h-3.5 w-3.5" /> {readingTimeMinutes(article.body)} min read
                  </span>
                </p>
              </div>
            </div>
          </div>
        </Container>
      </header>

      <Container className="py-12">
        <div className={hasToc ? "grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_240px]" : ""}>
          <div className="mx-auto w-full min-w-0 max-w-3xl lg:mx-0">
            {fm.sponsored && fm.sponsor && (
              <p className="mb-8 rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-950 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-100">
                Sponsored by {fm.sponsor}. See the{" "}
                <Link href="/editorial-policy" className="font-medium underline">
                  editorial policy
                </Link>{" "}
                for how sponsored content is handled.
              </p>
            )}
            {fm.contentType === "curated" && (
              <p className="mb-8 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                Curated summary: this piece summarises the sources listed at the end. Read them for full detail.
              </p>
            )}

            {fm.featuredImage && (
              <figure className="mb-10">
                <Image
                  src={fm.featuredImage.src}
                  alt={fm.featuredImage.alt}
                  width={fm.featuredImage.width}
                  height={fm.featuredImage.height}
                  sizes="(min-width: 1024px) 768px, 100vw"
                  loading="eager"
                  fetchPriority="high"
                  className="h-auto w-full rounded-2xl border border-slate-200 dark:border-white/10"
                />
              </figure>
            )}

            {hasToc && (
              <details className="mb-10 rounded-xl border border-slate-200 p-4 lg:hidden dark:border-white/10">
                <summary className="cursor-pointer text-sm font-semibold text-ink dark:text-white">On this page</summary>
                <div className="mt-4">
                  <TableOfContents headings={headings} id="toc-heading-mobile" />
                </div>
              </details>
            )}

            <div className="prose prose-slate max-w-none prose-lg dark:prose-invert prose-headings:font-semibold prose-pre:my-0 prose-p:leading-8">
              <Content components={{ ...mdxComponents, nav: () => <TableOfContents headings={headings} id="toc-inline" /> }} />
            </div>

            {!article.preview && <ArticleEngagement collection={collection} slug={article.slug} />}
            {!article.preview && ads?.slots.articleEnd && <AdSlot client={ads.client} slot={ads.slots.articleEnd} test={ads.test} />}

            {fm.sources.length > 0 && (
              <section aria-labelledby="sources" className="mt-14 rounded-2xl border border-slate-200 p-6 dark:border-white/10">
                <h2 id="sources" className="text-lg font-semibold text-ink dark:text-white">
                  Sources
                </h2>
                <ol className="mt-4 space-y-3 text-sm">
                  {fm.sources.map((s, i) => (
                    <li key={s.url} className="flex gap-3">
                      <span className="font-mono text-slate-400">{i + 1}.</span>
                      <span>
                        <a href={s.url} className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 dark:text-brand-300" rel="noopener">
                          {s.title}
                        </a>
                        <span className="text-slate-500 dark:text-slate-400"> — {s.publisher}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {fm.corrections.length > 0 && (
              <section aria-labelledby="corrections" className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/60 p-6 dark:border-amber-500/30 dark:bg-amber-500/5">
                <h2 id="corrections" className="text-lg font-semibold text-ink dark:text-white">
                  Corrections
                </h2>
                <ul className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-300">
                  {fm.corrections.map((c) => (
                    <li key={c.date}>
                      <time dateTime={c.date} className="font-medium">
                        {formatDateTime(c.date)}
                      </time>
                      : {c.note}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm">
                  <Link href="/corrections-policy" className="font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300">
                    How corrections work
                  </Link>
                </p>
              </section>
            )}

            <footer className="mt-12 space-y-8 border-t border-slate-200 pt-8 dark:border-white/10">
              <TagList tags={fm.tags} />
              <AuthorCard author={author} />
            </footer>

            {article.id && !article.preview && <Comments postId={article.id} path={article.path} />}
          </div>

          {hasToc && (
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <TableOfContents headings={headings} />
              </div>
            </aside>
          )}
        </div>
      </Container>

      {related.length > 0 && (
        <section aria-labelledby="related" className="border-t border-slate-200 bg-slate-50/60 py-16 dark:border-white/10 dark:bg-white/[0.02]">
          <Container>
            <h2 id="related" className="text-2xl font-bold tracking-tight text-ink dark:text-white">
              Related reading
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((a) => (
                <li key={a.path}>
                  <ArticleCard article={a} cats={cats} headingLevel={3} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}
    </article>
  );
}
