import type { Metadata } from "next";
import { ArticleList } from "@/components/ArticleList";
import { Avatar } from "@/components/AuthorCard";
import { Container } from "@/components/Container";
import { GitHubIcon, LinkedInIcon } from "@/components/icons";
import { JsonLd } from "@/components/JsonLd";
import { mdxComponents } from "@/components/Mdx";
import { PageHeader } from "@/components/PageHeader";
import { buttonClass } from "@/components/ui/form";
import { Pagination } from "@/components/Pagination";
import { getAuthor, type Article, type Paged } from "@/lib/content";
import { compileMdx } from "@/lib/mdx/compile";
import { breadcrumbLd, profilePageLd } from "@/lib/seo/jsonld";
import { listingMetadata } from "./listing";
import { authorListing } from "./listings";

export async function authorMetadata(slug: string, page = 1): Promise<Metadata> {
  return listingMetadata(await authorListing(slug), page);
}

function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

export async function AuthorProfilePage({ slug, paged }: { slug: string; paged: Paged<Article> }) {
  const listing = await authorListing(slug);
  const author = (await getAuthor(slug))!;
  const fm = author.frontmatter;
  const { Content } = await compileMdx(author.body);
  const hasBio = author.body.trim().length > 0;

  return (
    <>
      <JsonLd data={[profilePageLd(author), breadcrumbLd(listing.crumbs)]} />
      <PageHeader
        title={fm.name}
        eyebrow={fm.jobTitle ?? "Author"}
        crumbs={listing.crumbs}
        icon={
          <span className="hidden sm:block">
            <Avatar name={fm.name} size="lg" />
          </span>
        }
      >
        {fm.sameAs.length > 0 && (
          <ul aria-label="Profiles" className="flex flex-wrap gap-3">
            {fm.sameAs.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  rel="me noopener"
                  className={buttonClass("secondary", "sm")}
                >
                  {url.includes("github.com") && <GitHubIcon className="h-4 w-4" />}
                  {url.includes("linkedin.com") && <LinkedInIcon className="h-4 w-4" />}
                  {hostLabel(url)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </PageHeader>
      <Container className="pt-10 sm:pt-12">
        {paged.page === 1 && hasBio && (
          <div className="article-body prose mb-14 max-w-reading dark:prose-invert">
            <Content components={mdxComponents} />
          </div>
        )}
        <h2 className="mb-6 text-heading font-semibold text-fg">Published work</h2>
        <ArticleList articles={paged.items} emptyText="Nothing published yet" headingLevel={3} />
        <Pagination basePath={listing.basePath} page={paged.page} totalPages={paged.totalPages} />
      </Container>
    </>
  );
}
