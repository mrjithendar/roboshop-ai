#!/usr/bin/env bash
# Create or update ConfigMap jithendar/jithendar-com-public: public identifiers for search-engine
# verification, Google Analytics 4, Google AdSense, ads.txt and IndexNow. None of these are secrets
# (they appear in page HTML or public files), but they are account-specific, so they are not in Git.
#   scripts/set-public-config.sh [kube-context]
# Leave a prompt empty to leave that setting unset. Then restart:
#   kubectl --context mk4 -n jithendar rollout restart deployment/jithendar-com
set -euo pipefail
CONTEXT="${1:-mk4}"
NS="jithendar"

args=()
ask() { local v; read -r -p "$2: " v; [[ -n "$v" ]] && args+=(--from-literal="$1=$v"); return 0; }

echo "Leave empty to skip. Prefer DNS verification for Google Search Console (docs/SEO_ANALYTICS_ADS.md)."
ask GOOGLE_SITE_VERIFICATION "Google Search Console HTML-tag token (content=\"…\" value only)"
ask BING_SITE_VERIFICATION "Bing Webmaster Tools msvalidate.01 token"
ask GA4_MEASUREMENT_ID "GA4 measurement ID (G-XXXXXXXXXX)"
ask ADSENSE_CLIENT_ID "AdSense publisher ID (ca-pub-XXXXXXXXXXXXXXXX)"
ask ADSENSE_SLOT_ARTICLE_END "AdSense ad unit slot ID for the end of articles (digits)"
ask ADS_TXT "Exact ads.txt line from AdSense (Sites → ads.txt snippet)"
ask CONSENT_DEFAULT "Consent default: regional (deny in EEA/UK/CH) or strict (deny everywhere) [regional]"
read -r -p "Generate a new IndexNow key? [y/N]: " gen
[[ "$gen" == "y" || "$gen" == "Y" ]] && args+=(--from-literal="INDEXNOW_KEY=$(openssl rand -hex 16)")

kubectl --context "$CONTEXT" -n "$NS" create configmap jithendar-com-public "${args[@]}" --dry-run=client -o yaml \
  | kubectl --context "$CONTEXT" -n "$NS" apply -f -
echo "ConfigMap $NS/jithendar-com-public updated. Restart: kubectl --context $CONTEXT -n $NS rollout restart deployment/jithendar-com"
