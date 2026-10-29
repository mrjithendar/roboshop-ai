import { notFound, permanentRedirect } from "next/navigation";
import { findRedirect } from "@/lib/redirects";
import { createElement } from "react";
import { toneFor } from "@/components/categoryStyle";
import { iconFor } from "@/components/icons";
import { getCategories, getCategoryMap } from "@/lib/categories";
import { collectionLabels, type Collection } from "@/config/taxonomy";
import { articlesInCategory, articlesWithTag, getAuthor, getPublishedContent, isCategoryIndexable, publishedTags } from "@/lib/content";
import { getSiteConfig } from "@/lib/site-config";
import type { Listing } from "./listing";

const home = { name: "Home", path: "/" };

/** Articles per listing page (Admin → Appearance → Blog). */
async function listingPageSize(): Promise<number> {
  return (await getSiteConfig()).config.blog.listing.pageSize;
}

export const collectionDescriptions: Record<Collection, string> = {
  blog: "Tutorials, analysis and opinion on building and running AI, cloud and platform systems.",
  news: "Timely, sourced coverage of releases and security advisories across AI, cloud and cloud-native tooling.",
  projects: "Engineering projects, with the architecture and lessons behind them.",
};

export async function collectionListing(collection: Collection): Promise<Listing> {
  const articles = await getPublishedContent({ collection });
  return {
    pageSize: await listingPageSize(),
    title: collectionLabels[collection],
    description: collectionDescriptions[collection],
    basePath: `/${collection}`,
    crumbs: [home, { name: collectionLabels[collection], path: `/${collection}` }],
    articles,
    indexable: articles.length > 0,
    eyebrow: "Publication",
    chips: (await getCategories()).map((c) => ({ href: `/category/${c.slug}`, label: c.label })),
  };
}

export async function categoryListing(slug: string): Promise<Listing> {
  const category = (await getCategoryMap()).get(slug);
  if (!category) {
    const moved = await findRedirect(`/category/${slug}`);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  return {
    pageSize: await listingPageSize(),
    title: category.label,
    description: category.intro,
    basePath: `/category/${slug}`,
    crumbs: [home, { name: category.label, path: `/category/${slug}` }],
    articles: await articlesInCategory(slug),
    indexable: await isCategoryIndexable(slug),
    feedHref: `/category/${slug}/feed.xml`,
    eyebrow: "Topic",
    icon: createElement(
      "span",
      { className: `hidden sm:inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ${toneFor(category.tone)}` },
      createElement(iconFor(category.icon), { className: "h-8 w-8" }),
    ),
  };
}

/** Tag pages have no editorial intro, so they are always noindex, follow. */
export async function tagListing(slug: string): Promise<Listing> {
  const tag = (await publishedTags()).find((t) => t.slug === slug);
  if (!tag) notFound();
  return {
    pageSize: await listingPageSize(),
    title: `#${tag.label}`,
    description: `Articles tagged “${tag.label}” on Jithendar.com.`,
    basePath: `/tag/${slug}`,
    crumbs: [home, { name: `#${tag.label}`, path: `/tag/${slug}` }],
    articles: await articlesWithTag(slug),
    indexable: false,
    eyebrow: "Tag",
  };
}

export async function authorListing(slug: string): Promise<Listing> {
  const author = await getAuthor(slug);
  if (!author) notFound();
  const articles = (await getPublishedContent()).filter((a) => a.frontmatter.author === slug);
  return {
    pageSize: await listingPageSize(),
    title: author.frontmatter.name,
    description: `Articles and projects by ${author.frontmatter.name} on Jithendar.com.`,
    basePath: author.path,
    crumbs: [home, { name: author.frontmatter.name, path: author.path }],
    articles,
    // An author page with no published work is thin content.
    indexable: articles.length > 0,
  };
}
