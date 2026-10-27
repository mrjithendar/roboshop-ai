import { absoluteUrl, site, siteUrl } from "@/config/site";
import type { ContentType } from "@/config/taxonomy";
import type { Article, Author } from "@/lib/content";
import { canonicalFor } from "./canonical";

type JsonLdObject = { "@context"?: "https://schema.org"; "@type": string; [key: string]: unknown };

/** Serialize for a <script type="application/ld+json"> block; escaping "<" prevents breaking out of the tag. */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function personLd(author: Author): JsonLdObject {
  const fm = author.frontmatter;
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${absoluteUrl(author.path)}#person`,
    name: fm.name,
    url: absoluteUrl(author.path),
    ...(fm.jobTitle ? { jobTitle: fm.jobTitle } : {}),
    ...(fm.sameAs.length > 0 ? { sameAs: fm.sameAs } : {}),
  };
}

export function organizationLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl()}/#organization`,
    name: site.publicationName,
    url: siteUrl(),
  };
}

export function websiteLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl()}/#website`,
    name: site.name,
    url: siteUrl(),
    inLanguage: site.language,
    publisher: { "@id": `${siteUrl()}/#organization` },
  };
}

export function profilePageLd(author: Author): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: absoluteUrl(author.path),
    mainEntity: personLd(author),
  };
}

const articleType: Record<ContentType, string> = {
  news: "NewsArticle",
  analysis: "NewsArticle",
  tutorial: "BlogPosting",
  opinion: "BlogPosting",
  curated: "BlogPosting",
  project: "CreativeWork",
};

/** Article markup. Every value mirrors what the article page renders. */
export function articleLd(article: Article, author: Author): JsonLdObject {
  const fm = article.frontmatter;
  const type = articleType[fm.contentType];
  const isArticle = type !== "CreativeWork";
  const image = fm.featuredImage
    ? { "@type": "ImageObject", url: absoluteUrl(fm.featuredImage.src), width: fm.featuredImage.width, height: fm.featuredImage.height }
    : undefined;
  return {
    "@context": "https://schema.org",
    "@type": type,
    [isArticle ? "headline" : "name"]: fm.title,
    description: fm.description,
    url: canonicalFor(article),
    mainEntityOfPage: canonicalFor(article),
    inLanguage: site.language,
    datePublished: fm.publishedAt,
    ...(fm.updatedAt ? { dateModified: fm.updatedAt } : {}),
    author: { "@type": "Person", name: author.frontmatter.name, url: absoluteUrl(author.path) },
    publisher: { "@type": "Organization", name: site.publicationName, url: siteUrl() },
    ...(image ? { image } : {}),
    ...(isArticle ? { articleSection: fm.category } : {}),
    ...(fm.tags.length > 0 ? { keywords: fm.tags.join(", ") } : {}),
  };
}

export type Crumb = { name: string; path: string };

export function breadcrumbLd(crumbs: Crumb[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}
