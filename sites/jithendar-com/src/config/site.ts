/** Site identity and environment. Server-only values; never prefix these with NEXT_PUBLIC_. */

export const PRODUCTION_HOST = "jithendar.com";

export const site = {
  name: "Jithendar.com",
  // TODO(owner): confirm "Jithendar.com" as the publication name for Google News and JSON-LD.
  publicationName: "Jithendar.com",
  description:
    "Engineering notes, news and analysis on AI engineering, cloud, Kubernetes, platform engineering, infrastructure as code and security.",
  language: "en",
  locale: "en_US",
  timeZone: "Asia/Kolkata",
  primaryAuthor: "jithendar-dharmapuri",
} as const;

export function siteUrl(): string {
  const url = process.env.SITE_URL ?? `https://${PRODUCTION_HOST}`;
  return url.replace(/\/+$/, "");
}

export function absoluteUrl(path: string): string {
  if (path === "/" || path === "") return siteUrl();
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Build-time/runtime environment flag. Anything other than production is never indexable. */
export function isProductionEnv(): boolean {
  return process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production";
}

/**
 * Local preview of unpublished work: `CONTENT_PREVIEW=true npm run dev`.
 * Ignored whenever APP_ENV is production, so it can never leak drafts to the live site.
 */
export function isContentPreview(): boolean {
  return process.env.CONTENT_PREVIEW === "true" && !isProductionEnv();
}

/** Request-time check: production environment *and* served on the canonical host. */
export function isIndexableHost(host: string | null | undefined): boolean {
  if (!isProductionEnv() || !host) return false;
  return host.toLowerCase().replace(/:\d+$/, "") === PRODUCTION_HOST;
}
