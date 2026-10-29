import type { Metadata } from "next";
import { integrations, adsTxt } from "@/config/integrations";
import { enabledProviders } from "@/lib/auth-providers";
import { getCategories } from "@/lib/categories";
import { getAuthors, getPages, getPublishedContent } from "@/lib/content";
import { geminiImageConfig } from "@/lib/gemini";
import { mailConfigured } from "@/lib/mail";
import { requireRole } from "@/lib/session";
import { getDraft, getPublishedConfig } from "@/lib/site-config/store";
import { storageReady } from "@/lib/storage";
import { turnstileSecret, turnstileSiteKey } from "@/lib/turnstile";
import { AppearanceEditor, type EditorContext } from "./AppearanceEditor";

export const metadata: Metadata = { title: "Appearance & site settings" };
export const dynamic = "force-dynamic";

/**
 * Admin → Appearance & Site Settings. Admins only. The editor works on the shared private draft;
 * readers see changes only after "Publish".
 */
export default async function AppearancePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  await requireRole("admin");
  const [draft, published, categories, authors, pages, storage, mail, sp, articles] = await Promise.all([
    getDraft(),
    getPublishedConfig(),
    getCategories(),
    getAuthors(),
    getPages(),
    storageReady(),
    mailConfigured(),
    searchParams,
    getPublishedContent(),
  ]);
  const article = articles.find((a) => a.collection !== "projects");
  const i = integrations();
  // Status only: secrets are never sent to the browser, not even masked fragments.
  const ctx: EditorContext = {
    categories: categories.map((c) => ({ slug: c.slug, label: c.label })),
    authors: authors.map((a) => ({ slug: a.slug, name: a.frontmatter.name })),
    pages: pages.map((p) => ({ path: p.path, title: p.frontmatter.title })),
    // Pages to preview: one of each layout, using real content.
    samplePaths: [
      { path: "/", label: "Homepage" },
      { path: "/blog", label: "Articles listing" },
      ...(article ? [{ path: article.path, label: `Article: ${article.frontmatter.title.slice(0, 60)}` }] : []),
      ...(categories[0] ? [{ path: `/category/${categories[0].slug}`, label: `Topic: ${categories[0].label}` }] : []),
      ...(pages[0] ? [{ path: pages[0].path, label: `Page: ${pages[0].frontmatter.title}` }] : []),
      { path: "/search", label: "Search" },
    ],
    published: published.config,
    publishedVersion: published.version,
    publishedAt: published.updatedAt?.toISOString() ?? null,
    status: {
      storage,
      mail,
      turnstile: Boolean(turnstileSiteKey() && turnstileSecret()),
      gemini: Boolean(geminiImageConfig()),
      oauth: enabledProviders(),
      googleVerification: i.verification.google.length,
      bingVerification: i.verification.bing.length,
      ga4: Boolean(process.env.GA4_MEASUREMENT_ID?.trim()),
      ga4Active: Boolean(i.ga4),
      adsense: i.adsense ? { slots: Object.values(i.adsense.slots).filter(Boolean).length, test: i.adsense.test } : null,
      adsTxt: Boolean(adsTxt()),
      consentDefault: i.consentDefault,
      indexNow: Boolean(i.indexNowKey),
    },
  };
  return (
    <AppearanceEditor
      initial={{ config: draft.config, version: draft.version, baseVersion: draft.baseVersion, updatedAt: draft.updatedAt?.toISOString() ?? null }}
      context={ctx}
      initialSection={sp.section}
    />
  );
}
