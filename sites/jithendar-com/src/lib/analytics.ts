/**
 * Client-safe analytics helpers (no server imports). GA4 receives only what is listed here:
 *
 *   page_view        page_location (origin + path, query stripped except ?page=), page_title
 *   article_engaged  content_group (blog|news|projects), article_slug — sent once when the reader reaches the end
 *   (outbound clicks and file downloads come from GA4 enhanced measurement; see docs/ANALYTICS_ADS.md)
 *
 * Never sent: query strings (search terms), form contents, emails, phone numbers, user ids, credentials.
 */

const ALLOWED_QUERY = new Set(["page"]);

/** The URL GA4 sees: no fragments, no query parameters except an allowlist. */
export function cleanLocation(origin: string, pathname: string, search = ""): string {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const [k, v] of params) if (ALLOWED_QUERY.has(k) && /^\d{1,4}$/.test(v)) kept.set(k, v);
  const q = kept.toString();
  return `${origin}${pathname}${q ? `?${q}` : ""}`;
}

/**
 * Exactly one page_view per distinct location: React may run effects twice (Strict Mode) and the
 * router can re-render without navigating; both would otherwise double-count.
 */
export class PageViewDeduper {
  private last: string | null = null;
  shouldSend(location: string): boolean {
    if (location === this.last) return false;
    this.last = location;
    return true;
  }
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;

/** Drop any parameter value that looks like personal data, and anything that is not a short scalar. */
export function safeParams(params: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= 100 && !EMAIL.test(v) && !PHONE.test(v)) out[k] = v;
  }
  return out;
}

type Gtag = (...args: unknown[]) => void;

/** Send an event if GA4 is loaded (no-op when it is not configured, not allowed, or blocked). */
export function track(event: string, params: Record<string, unknown> = {}) {
  const gtag = (globalThis as { gtag?: Gtag }).gtag;
  if (typeof gtag !== "function") return;
  try {
    gtag("event", event, safeParams(params));
  } catch {
    /* analytics must never break the page */
  }
}
