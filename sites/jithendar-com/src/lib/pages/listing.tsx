import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";
import { ArticleList } from "@/components/ArticleList";
import { Container } from "@/components/Container";
import { RssIcon } from "@/components/icons";
import { JsonLd } from "@/components/JsonLd";
import { PageHeader } from "@/components/PageHeader";
import { pageHref, Pagination } from "@/components/Pagination";
import { absoluteUrl, site } from "@/config/site";
import { paginate, parsePageParam, type Article, type Paged } from "@/lib/content";
import { breadcrumbLd, type Crumb } from "@/lib/seo/jsonld";

export type Listing = {
  title: string;
  description: string;
  basePath: string;
  crumbs: Crumb[];
  articles: Article[];
  /** False → noindex, follow (thin or intro-less taxonomy). */
  indexable: boolean;
  eyebrow?: string;
  icon?: ReactNode;
  /** Optional chips under the header (e.g. topic filters). */
  chips?: { href: string; label: string }[];
  feedHref?: string;
  emptyText?: string;
  /** Items per page (configured; out-of-range pages 404). */
  pageSize?: number;
};

export type PageParams = { params: Promise<{ n: string }> };

/** Resolve the page for a /page/<n> route: 404 for invalid or out-of-range pages, 308 for /page/1. */
export function resolvePage(listing: Listing, raw?: string): Paged<Article> {
  if (raw === "1") permanentRedirect(listing.basePath);
  const page = raw === undefined ? 1 : parsePageParam(raw);
  const paged = page === undefined ? undefined : paginate(listing.articles, page, listing.pageSize);
  if (!paged) notFound();
  return paged;
}

/** Static params for pages 2..n of a listing. */
export function extraPageParams(articles: Article[], size?: number): { n: string }[] {
  const total = paginate(articles, 1, size)?.totalPages ?? 1;
  return Array.from({ length: Math.max(0, total - 1) }, (_, i) => ({ n: String(i + 2) }));
}

export function listingMetadata(listing: Listing, page = 1): Metadata {
  const path = pageHref(listing.basePath, page);
  const title = page > 1 ? `${listing.title} (page ${page})` : listing.title;
  return {
    title,
    description: listing.description,
    alternates: {
      canonical: absoluteUrl(path),
      ...(listing.feedHref ? { types: { "application/rss+xml": absoluteUrl(listing.feedHref) } } : {}),
    },
    openGraph: { type: "website", url: absoluteUrl(path), siteName: site.name, locale: site.locale, title, description: listing.description },
    ...(listing.indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export function ListingPage({ listing, paged }: { listing: Listing; paged: Paged<Article> }) {
  const crumbs = paged.page > 1 ? [...listing.crumbs, { name: `Page ${paged.page}`, path: pageHref(listing.basePath, paged.page) }] : listing.crumbs;
  const count = listing.articles.length;
  return (
    <>
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHeader title={listing.title} description={listing.description} eyebrow={listing.eyebrow} crumbs={crumbs} icon={listing.icon}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-subtle">
          <span>
            {count} {count === 1 ? "article" : "articles"}
          </span>
          {listing.feedHref && (
            <a href={listing.feedHref} className="inline-flex min-h-8 items-center gap-1.5 font-medium text-fg-muted hover:text-fg hover:underline">
              <RssIcon className="h-4 w-4" /> RSS feed
            </a>
          )}
        </div>
        {listing.chips && listing.chips.length > 0 && (
          <ul aria-label="Topics" className="mt-5 flex flex-wrap gap-2">
            {listing.chips.map((chip) => (
              <li key={chip.href}>
                <Link
                  href={chip.href}
                  className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                >
                  {chip.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageHeader>
      <Container className="pt-10 sm:pt-12">
        <ArticleList articles={paged.items} emptyText={listing.emptyText ?? "Nothing published here yet"} />
        <Pagination basePath={listing.basePath} page={paged.page} totalPages={paged.totalPages} />
      </Container>
    </>
  );
}
