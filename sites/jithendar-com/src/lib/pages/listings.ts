import { notFound } from "next/navigation";
import { categories, categoryIntros, categoryKeys, collectionLabels, type Category, type Collection } from "@/config/taxonomy";
import { articlesInCategory, articlesWithTag, getAuthor, getPublishedContent, isCategoryIndexable, publishedTags } from "@/lib/content";
import type { Listing } from "./listing";

const home = { name: "Home", path: "/" };

export const collectionDescriptions: Record<Collection, string> = {
  blog: "Tutorials, analysis and opinion on building and running AI, cloud and platform systems.",
  news: "Timely, sourced coverage of releases and security advisories across AI, cloud and cloud-native tooling.",
  projects: "Engineering projects, with the architecture and lessons behind them.",
};

export function collectionListing(collection: Collection): Listing {
  const articles = getPublishedContent({ collection });
  return {
    title: collectionLabels[collection],
    description: collectionDescriptions[collection],
    basePath: `/${collection}`,
    crumbs: [home, { name: collectionLabels[collection], path: `/${collection}` }],
    articles,
    indexable: articles.length > 0,
  };
}

export function isCategory(value: string): value is Category {
  return (categoryKeys as string[]).includes(value);
}

export function categoryListing(category: string): Listing {
  if (!isCategory(category)) notFound();
  return {
    title: categories[category],
    description: categoryIntros[category],
    basePath: `/category/${category}`,
    crumbs: [home, { name: categories[category], path: `/category/${category}` }],
    articles: articlesInCategory(category),
    indexable: isCategoryIndexable(category),
    feedHref: `/category/${category}/feed.xml`,
  };
}

/** Tag pages have no editorial intro, so they are always noindex, follow. */
export function tagListing(slug: string): Listing {
  const tag = publishedTags().find((t) => t.slug === slug);
  if (!tag) notFound();
  return {
    title: `#${tag.label}`,
    description: `Articles tagged “${tag.label}” on Jithendar.com.`,
    basePath: `/tag/${slug}`,
    crumbs: [home, { name: `#${tag.label}`, path: `/tag/${slug}` }],
    articles: articlesWithTag(slug),
    indexable: false,
  };
}

export function authorListing(slug: string): Listing {
  const author = getAuthor(slug);
  if (!author) notFound();
  const articles = getPublishedContent().filter((a) => a.frontmatter.author === slug);
  return {
    title: author.frontmatter.name,
    description: `Articles and projects by ${author.frontmatter.name} on Jithendar.com.`,
    basePath: author.path,
    crumbs: [home, { name: author.frontmatter.name, path: author.path }],
    articles,
    // An author page with no published work is thin content.
    indexable: articles.length > 0,
  };
}
