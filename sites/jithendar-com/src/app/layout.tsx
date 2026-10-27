import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { absoluteUrl, isProductionEnv, site, siteUrl } from "@/config/site";
import "./globals.css";

// next/font downloads these at build time and serves them from this site.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

// No canonical here on purpose: every indexable page sets its own, and an inherited
// root canonical would point unrelated pages at the homepage.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: site.name, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  alternates: { types: { "application/rss+xml": absoluteUrl("/feed.xml") } },
  robots: isProductionEnv() ? { index: true, follow: true } : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1220" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={site.language} className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg dark:focus:bg-surface-dark-raised"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
