import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Inter, JetBrains_Mono, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AnnouncementBar, announcementId, announcementScript } from "@/components/AnnouncementBar";
import { integrations } from "@/config/integrations";
import { absoluteUrl, isProductionEnv, site, siteUrl } from "@/config/site";
import { ThirdParty } from "@/components/integrations/ThirdParty";
import { HideOnAdmin } from "@/components/HideOnAdmin";
import { themeScript } from "@/components/theme/script";
import { PreviewBanner } from "@/components/PreviewBanner";
import { getSiteConfig } from "@/lib/site-config";
import { themeCss } from "@/lib/site-config/css";
import "./globals.css";

// next/font downloads these at build time and serves them from this site.
// Inter is a variable font (one file covers 400–700); the mono face is only needed in code, so it is not preloaded.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap", preload: false });
// The curated alternatives offered in Admin → Appearance → Typography. Declared here so next/font self-hosts
// them; a face is only downloaded when the configured theme uses it.
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ibm-plex-sans", display: "swap", preload: false });
const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans", display: "swap", preload: false });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap", preload: false });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-mono", display: "swap", preload: false });
const fontVariables = [inter, jetbrains, plexSans, sourceSans, sourceSerif, plexMono].map((f) => f.variable).join(" ");

// No canonical here on purpose: every indexable page sets its own, and an inherited
// root canonical would point unrelated pages at the homepage.
export async function generateMetadata(): Promise<Metadata> {
  const { config, preview } = await getSiteConfig();
  const g = config.general;
  const { verification } = integrations();
  const { favicon, appleIcon } = config.branding;
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: g.siteName, template: `%s ${config.seo.titleSeparator} ${g.siteName}` },
    description: g.description,
    applicationName: g.siteName,
    ...(favicon || appleIcon
      ? { icons: { ...(favicon ? { icon: [{ url: favicon.src }] } : {}), ...(appleIcon ? { apple: [{ url: appleIcon.src }] } : {}) } }
      : {}),
    alternates: { types: { "application/rss+xml": absoluteUrl("/feed.xml") } },
    robots: isProductionEnv() && !preview ? { index: true, follow: true } : { index: false, follow: false },
    // Search Console / Bing Webmaster Tools HTML-tag verification (DNS verification needs none of this).
    verification: {
      ...(verification.google.length ? { google: verification.google } : {}),
      ...(verification.bing.length ? { other: { "msvalidate.01": verification.bing } } : {}),
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1013" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { config, preview } = await getSiteConfig();
  const custom = config.advanced.customCss;
  const ann = config.header.announcement;
  return (
    // suppressHydrationWarning: the theme script may set data-theme on <html> before React hydrates.
    <html lang={site.language} className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(config.theme.defaultMode) }} />
        {ann.enabled && ann.dismissible && <script dangerouslySetInnerHTML={{ __html: announcementScript(announcementId(ann.text, ann.href)) }} />}
        {/* Generated from validated tokens only (lib/site-config/css.ts). */}
        <style id="site-theme" dangerouslySetInnerHTML={{ __html: themeCss(config) }} />
        {custom.enabled && custom.css.trim() && <style id="site-custom-css" dangerouslySetInnerHTML={{ __html: custom.css }} />}
      </head>
      <body className="flex min-h-screen flex-col">
        {preview && <PreviewBanner />}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:shadow-lg"
        >
          Skip to content
        </a>
        <AnnouncementBar />
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <HideOnAdmin>
          <SiteFooter />
        </HideOnAdmin>
        <ThirdParty />
      </body>
    </html>
  );
}
