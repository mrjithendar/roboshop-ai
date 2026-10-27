import type { Metadata } from "next";
import { ArticleList } from "@/components/ArticleList";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { mdxComponents } from "@/components/Mdx";
import { Pagination } from "@/components/Pagination";
import { getAuthor, type Article, type Paged } from "@/lib/content";
import { compileMdx } from "@/lib/mdx/compile";
import { breadcrumbLd, profilePageLd } from "@/lib/seo/jsonld";
import { listingMetadata } from "./listing";
import { authorListing } from "./listings";

export function authorMetadata(slug: string, page = 1): Metadata {
  return listingMetadata(authorListing(slug), page);
}

function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

export async function AuthorProfilePage({ slug, paged }: { slug: string; paged: Paged<Article> }) {
  const listing = authorListing(slug);
  const author = getAuthor(slug)!;
  const fm = author.frontmatter;
  const { Content } = await compileMdx(author.body);
  const hasBio = author.body.trim().length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <JsonLd data={[profilePageLd(author), breadcrumbLd(listing.crumbs)]} />
      <Breadcrumbs crumbs={listing.crumbs} />
      <header className="mt-4 max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{fm.name}</h1>
        {fm.jobTitle && <p className="mt-1 text-lg text-zinc-600 dark:text-zinc-400">{fm.jobTitle}</p>}
        {fm.sameAs.length > 0 && (
          <ul aria-label="Profiles" className="mt-3 flex flex-wrap gap-4 text-sm">
            {fm.sameAs.map((url) => (
              <li key={url}>
                <a href={url} rel="me noopener" className="underline">
                  {hostLabel(url)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </header>
      {paged.page === 1 && hasBio && (
        <div className="prose prose-zinc mt-6 max-w-3xl dark:prose-invert">
          <Content components={mdxComponents} />
        </div>
      )}
      <h2 className="mt-12 text-xl font-semibold">Published work</h2>
      <div className="mt-6">
        <ArticleList articles={paged.items} emptyText="Nothing published yet." headingLevel={3} />
      </div>
      <Pagination basePath={listing.basePath} page={paged.page} totalPages={paged.totalPages} />
    </div>
  );
}
