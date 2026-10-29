import { isProductionEnv } from "./site";

/**
 * Third-party integrations, configured at runtime from environment variables (no rebuild needed).
 * Every value here is a *public identifier* that ends up in page HTML anyway (verification tokens,
 * GA4 measurement ID, AdSense publisher/slot IDs, the IndexNow key). Invalid values disable the
 * integration instead of being injected into pages. Nothing here is a secret.
 */
type Env = Record<string, string | undefined>;

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const valid = (re: RegExp, v: string | undefined) => (v && re.test(v.trim()) ? v.trim() : undefined);

/** EEA (EU + IS, LI, NO), United Kingdom and Switzerland: regions where Google requires consent before ad/analytics storage. */
export const CONSENT_REGIONS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "GB", "CH",
] as const;

export type Integrations = {
  verification: { google: string[]; bing: string[] };
  /** GA4 measurement ID (G-…), only in production. */
  ga4: string | null;
  adsense: { client: string; slots: { articleEnd?: string; listing?: string }; test: boolean } | null;
  /** "regional": denied by default in CONSENT_REGIONS, granted elsewhere. "strict": denied everywhere until the visitor consents. */
  consentDefault: "regional" | "strict";
  indexNowKey: string | null;
};

export function integrations(env: Env = process.env, production = isProductionEnv()): Integrations {
  const token = /^[A-Za-z0-9_-]{10,100}$/;
  const client = valid(/^ca-pub-\d{10,20}$/, env.ADSENSE_CLIENT_ID);
  const slot = (v: string | undefined) => valid(/^\d{6,20}$/, v);
  return {
    verification: {
      google: list(env.GOOGLE_SITE_VERIFICATION).filter((t) => token.test(t)),
      bing: list(env.BING_SITE_VERIFICATION).filter((t) => token.test(t)),
    },
    ga4: production ? (valid(/^G-[A-Z0-9]{4,16}$/, env.GA4_MEASUREMENT_ID) ?? null) : null,
    // Outside production, ads are only shown as Google test ads (data-adtest="on"), and only when explicitly allowed.
    adsense: client && (production || env.ADSENSE_TEST_MODE === "true")
      ? { client, slots: { articleEnd: slot(env.ADSENSE_SLOT_ARTICLE_END), listing: slot(env.ADSENSE_SLOT_LISTING) }, test: !production }
      : null,
    consentDefault: env.CONSENT_DEFAULT === "strict" ? "strict" : "regional",
    indexNowKey: valid(/^[A-Za-z0-9-]{8,128}$/, env.INDEXNOW_KEY) ?? null,
  };
}

/** The exact ads.txt text supplied by the AdSense account (ADS_TXT; "\n" separates lines). Never generated. */
export function adsTxt(env: Env = process.env): string | null {
  const raw = env.ADS_TXT?.replace(/\\n/g, "\n").trim();
  return raw ? `${raw}\n` : null;
}

/** Paths that never get analytics or ads: private, editorial, auth and preview routes. */
const PRIVATE = /^\/(admin|account|login|setup|preview|api)(\/|$)/;
export function isTrackablePath(pathname: string): boolean {
  return !PRIVATE.test(pathname);
}
