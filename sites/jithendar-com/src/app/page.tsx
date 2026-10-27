import type { Metadata } from "next";
import { ArticleList } from "@/components/ArticleList";
import { JsonLd } from "@/components/JsonLd";
import { site, siteUrl } from "@/config/site";
import { getPublishedContent } from "@/lib/content";
import { organizationLd, websiteLd } from "@/lib/seo/jsonld";

export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: site.name },
  alternates: { canonical: siteUrl() },
  openGraph: { type: "website", url: siteUrl(), siteName: site.name, locale: site.locale, title: site.name, description: site.description },
};

export default function HomePage() {
  const latest = getPublishedContent().slice(0, 10);
  return (
    <>
      <JsonLd data={[websiteLd(), organizationLd()]} />
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{site.name}</h1>
      <p className="mt-3 text-lg text-zinc-700 dark:text-zinc-300">{site.description}</p>
      <h2 className="mt-12 text-xl font-semibold">Latest</h2>
      <div className="mt-6">
        <ArticleList articles={latest} emptyText="Nothing published yet." />
      </div>
    </>
  );
}
