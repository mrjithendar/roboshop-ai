import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { absoluteUrl, site } from "@/config/site";
import { getPage } from "@/lib/content";
import { ContactForm } from "@/components/ContactForm";
import { PageView } from "@/lib/pages/page-view";
import { getSettings } from "@/lib/settings";
import { turnstileSiteKey } from "@/lib/turnstile";
import { findRedirect } from "@/lib/redirects";

type Props = { params: Promise<{ page: string }> };

// Only pages that exist in the database render; everything else at this level is a 404.
export const dynamic = "force-dynamic";

async function load(slug: string) {
  const page = await getPage(slug);
  if (!page) {
    const moved = await findRedirect(`/${slug}`);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  return page;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { frontmatter: fm, path } = await load((await params).page);
  const title = fm.seoTitle ?? fm.title;
  const description = fm.seoDescription ?? fm.description;
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { type: "website", url: absoluteUrl(path), siteName: site.name, locale: site.locale, title, description },
    ...(fm.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function StaticPage({ params }: Props) {
  const page = await load((await params).page);
  const contactForm = page.slug === "contact" && (await getSettings()).features.contactForm ? <ContactForm siteKey={turnstileSiteKey()} /> : undefined;
  return <PageView page={page} after={contactForm} />;
}
