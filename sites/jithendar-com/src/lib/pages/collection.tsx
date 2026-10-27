import type { Metadata } from "next";
import { ArticleList } from "@/components/ArticleList";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { absoluteUrl, site } from "@/config/site";
import { collectionLabels, type Collection } from "@/config/taxonomy";
import { getPublishedContent } from "@/lib/content";
import { breadcrumbLd } from "@/lib/seo/jsonld";

const intros: Record<Collection, string> = {
  blog: "Tutorials, analysis and opinion on building and running AI, cloud and platform systems.",
  news: "Timely, sourced coverage of releases and security advisories across AI, cloud and cloud-native tooling.",
  projects: "Engineering projects, with the architecture and lessons behind them.",
};

/** A listing with nothing published is thin content: keep it out of the index until it has items. */
export function collectionMetadata(collection: Collection): Metadata {
  const hasItems = getPublishedContent({ collection }).length > 0;
  return {
    title: collectionLabels[collection],
    description: intros[collection],
    alternates: { canonical: absoluteUrl(`/${collection}`) },
    openGraph: { type: "website", url: absoluteUrl(`/${collection}`), siteName: site.name, locale: site.locale, title: collectionLabels[collection], description: intros[collection] },
    ...(hasItems ? {} : { robots: { index: false, follow: true } }),
  };
}

export function CollectionPage({ collection }: { collection: Collection }) {
  const articles = getPublishedContent({ collection });
  const crumbs = [
    { name: "Home", path: "/" },
    { name: collectionLabels[collection], path: `/${collection}` },
  ];
  return (
    <>
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{collectionLabels[collection]}</h1>
      <p className="mt-2 text-zinc-700 dark:text-zinc-300">{intros[collection]}</p>
      <div className="mt-10">
        <ArticleList articles={articles} emptyText="Nothing published here yet." />
      </div>
    </>
  );
}
