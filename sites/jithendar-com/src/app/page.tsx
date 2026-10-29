import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { HomeSections } from "@/components/sections/HomeSections";
import { site, siteUrl } from "@/config/site";
import { getSiteConfig } from "@/lib/site-config";
import { organizationLd, websiteLd } from "@/lib/seo/jsonld";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getSiteConfig();
  const g = config.general;
  return {
    title: { absolute: config.seo.homeTitle },
    description: g.description,
    alternates: { canonical: siteUrl() },
    openGraph: { type: "website", url: siteUrl(), siteName: g.siteName, locale: site.locale, title: g.siteName, description: g.description },
  };
}

/** The homepage: sections configured in Admin → Appearance → Homepage. */
export default async function HomePage() {
  const { config } = await getSiteConfig();
  return (
    <>
      <JsonLd data={[websiteLd(), organizationLd()]} />
      <HomeSections config={config} />
    </>
  );
}
