import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArticleCard } from "@/components/ArticleList";
import { AuthorCard, Avatar } from "@/components/AuthorCard";
import { Comments } from "@/components/Comments";
import { Container } from "@/components/Container";
import { CategoryIcon, ChevronDown, ClockIcon } from "@/components/icons";
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

  const column = "mx-auto w-full min-w-0 max-w-reading";

  return (
    <article>
      {!article.preview && <JsonLd data={[articleLd(article, author), breadcrumbLd(crumbs)]} />}
      {notice}
      <Container className="pt-8 sm:pt-12">
        <header className={column}>
          <Breadcrumbs crumbs={crumbs} />
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Link href={`/category/${fm.category}`} className="inline-flex min-h-7 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline">
              <CategoryIcon name={category?.icon ?? "layers"} className="h-4 w-4" />
              {labelOf(cats, fm.category)}
            </Link>
            <ContentTypeBadge type={fm.contentType} />
            {fm.sponsored && <SponsoredBadge />}
            {article.preview && <PreviewBadge />}
          </div>
          <h1 className="mt-4 text-title font-bold text-fg text-balance [overflow-wrap:anywhere]">{fm.title}</h1>
          <p className="mt-4 text-lg leading-8 text-fg-muted sm:text-xl sm:leading-8">{fm.description}</p>
          <div className="mt-8 flex items-center gap-3 border-y border-line py-4">
            <Avatar name={author.frontmatter.name} size="sm" />
            <div className="min-w-0 text-sm leading-6">
              <p className="font-semibold text-fg">
                <Link href={author.path} rel="author" className="hover:underline">
                  {author.frontmatter.name}
                </Link>
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-fg-subtle">
                <span>
                  <time dateTime={fm.publishedAt}>{formatDateTime(fm.publishedAt!)}</time>
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
        </header>

        {fm.featuredImage && (
          <figure className="mx-auto mt-8 max-w-4xl">
            <Image
              src={fm.featuredImage.src}
              alt={fm.featuredImage.alt}
              width={fm.featuredImage.width}
              height={fm.featuredImage.height}
              sizes="(min-width: 960px) 896px, 100vw"
              loading="eager"
              fetchPriority="high"
              className="h-auto w-full rounded-xl border border-line"
            />
          </figure>
        )}

        <div className={`pb-4 pt-8 sm:pt-10 ${hasToc ? "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,var(--container-reading))_minmax(0,1fr)] xl:gap-x-12" : ""}`}>
          <div className={`${column} xl:col-start-2`}>
            {fm.sponsored && fm.sponsor && (
              <p className="mb-8 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm leading-6 text-yellow-950 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-100">
                Sponsored by {fm.sponsor}. See the{" "}
                <Link href="/editorial-policy" className="font-medium underline">
                  editorial policy
                </Link>{" "}
                for how sponsored content is handled.
              </p>
            )}
            {fm.contentType === "curated" && (
              <p className="mb-8 rounded-lg border border-line bg-surface-muted p-4 text-sm leading-6 text-fg-muted">
                Curated summary: this piece summarises the sources listed at the end. Read them for full detail.
              </p>
            )}

            {hasToc && (
              <details className="group mb-8 rounded-lg border border-line bg-surface-muted xl:hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-fg [&::-webkit-details-marker]:hidden">
                  On this page
                  <ChevronDown className="h-4 w-4 text-fg-subtle transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-line px-4 pb-4 pt-3">
                  <TableOfContents headings={headings} id="toc-heading-mobile" />
                </div>
              </details>
            )}

            <div className="article-body prose max-w-none dark:prose-invert">
              <Content components={{ ...mdxComponents, nav: () => <TableOfContents headings={headings} id="toc-inline" /> }} />
            </div>

            {!article.preview && <ArticleEngagement collection={collection} slug={article.slug} />}
            {!article.preview && ads?.slots.articleEnd && <AdSlot client={ads.client} slot={ads.slots.articleEnd} test={ads.test} />}

            {fm.sources.length > 0 && (
              <section aria-labelledby="sources" className="mt-12 border-t border-line pt-8">
                <h2 id="sources" className="text-lg font-semibold text-fg">
                  Sources
                </h2>
                <ol className="mt-4 space-y-3 text-[0.9375rem] leading-6">
                  {fm.sources.map((s, i) => (
                    <li key={s.url} className="flex gap-3">
                      <span className="w-5 shrink-0 text-right font-mono text-sm text-fg-subtle">{i + 1}.</span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <a href={s.url} className="link" rel="noopener">
                          {s.title}
                        </a>
                        <span className="text-fg-subtle"> — {s.publisher}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {fm.corrections.length > 0 && (
              <section aria-labelledby="corrections" className="mt-8 rounded-xl border border-amber-200 bg-amber-50/70 p-5 sm:p-6 dark:border-amber-500/30 dark:bg-amber-500/5">
                <h2 id="corrections" className="text-lg font-semibold text-fg">
                  Corrections
                </h2>
                <ul className="mt-3 space-y-2 text-[0.9375rem] leading-6 text-fg-muted">
                  {fm.corrections.map((c) => (
                    <li key={c.date}>
                      <time dateTime={c.date} className="font-medium text-fg">
                        {formatDateTime(c.date)}
                      </time>
                      : {c.note}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm">
                  <Link href="/corrections-policy" className="link">
                    How corrections work
                  </Link>
                </p>
              </section>
            )}

            <footer className="mt-12 space-y-8 border-t border-line pt-8">
              <TagList tags={fm.tags} />
              <AuthorCard author={author} />
            </footer>

            {article.id && !article.preview && <Comments postId={article.id} path={article.path} />}
          </div>

          {hasToc && (
            <aside className="hidden xl:col-start-3 xl:block">
              <div className="sticky top-[calc(var(--spacing-header)+2rem)] max-h-[calc(100dvh-var(--spacing-header)-4rem)] overflow-y-auto pb-4">
                <TableOfContents headings={headings} />
              </div>
            </aside>
          )}
        </div>
      </Container>

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-section border-t border-line bg-surface-muted py-section">
          <Container>
            <h2 id="related" className="text-heading font-semibold text-fg">
              Related reading
            </h2>
            <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
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
