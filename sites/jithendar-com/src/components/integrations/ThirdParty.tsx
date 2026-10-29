import { CONSENT_REGIONS, integrations } from "@/config/integrations";
import { AdSenseLoader, GoogleAnalytics } from "./ThirdPartyClient";

/**
 * Consent Mode v2 defaults, then (on public pages only) GA4 and the AdSense tag. Rendered nothing
 * when neither is configured. The AdSense tag also delivers Google's certified consent message
 * (AdSense → Privacy & messaging) to visitors in the EEA, UK and Switzerland; that message updates
 * the consent state below. Ads and analytics never block rendering (both load after hydration).
 */
export function consentDefaultsScript(mode: "regional" | "strict"): string {
  const denied = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" };
  const granted = { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" };
  const lines = [
    "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}",
    // Most specific default wins: regulated regions denied; elsewhere per mode.
    `gtag('consent','default',${JSON.stringify({ ...denied, region: CONSENT_REGIONS, wait_for_update: 500 })});`,
    `gtag('consent','default',${JSON.stringify({ ...(mode === "strict" ? denied : granted), wait_for_update: 500 })});`,
    "gtag('set','ads_data_redaction',true);",
  ];
  return lines.join("\n");
}

export function ThirdParty() {
  const cfg = integrations();
  if (!cfg.ga4 && !cfg.adsense) return null;
  return (
    <>
      {/* Inline and server-rendered, so it runs during parsing — before GA4 or AdSense (both load after hydration). */}
      <script id="consent-defaults" dangerouslySetInnerHTML={{ __html: consentDefaultsScript(cfg.consentDefault) }} />
      {cfg.ga4 && <GoogleAnalytics measurementId={cfg.ga4} />}
      {cfg.adsense && <AdSenseLoader client={cfg.adsense.client} />}
    </>
  );
}
