import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";
import { ArticleList } from "@/components/ArticleList";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
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
  intro?: ReactNode;
  feedHref?: string;
  emptyText?: string;
};

export type PageParams = { params: Promise<{ n: string }> };

/** Resolve the page for a /page/<n> route: 404 for invalid or out-of-range pages, 308 for /page/1. */
export function resolvePage(listing: Listing, raw?: string): Paged<Article> {
  if (raw === "1") permanentRedirect(listing.basePath);
  const page = raw === undefined ? 1 : parsePageParam(raw);
  const paged = page === undefined ? undefined : paginate(listing.articles, page);
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
  return (
    <div className="mx-auto max-w-5xl">
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{listing.title}</h1>
      <div className="mt-3 max-w-3xl text-zinc-700 dark:text-zinc-300">{listing.intro ?? <p>{listing.description}</p>}</div>
      {listing.feedHref && (
        <p className="mt-2 text-sm">
          <a href={listing.feedHref} className="underline">
            RSS feed
          </a>
        </p>
      )}
      <div className="mt-10">
        <ArticleList articles={paged.items} emptyText={listing.emptyText ?? "Nothing published here yet."} />
      </div>
      <Pagination basePath={listing.basePath} page={paged.page} totalPages={paged.totalPages} />
    </div>
  );
}
