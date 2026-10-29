#!/usr/bin/env bash
# Post-deploy smoke test. Usage: scripts/smoke.sh [origin] [expected-version]
# Exits non-zero on the first failed check.
set -euo pipefail

ORIGIN="${1:-https://jithendar.com}"
EXPECTED_VERSION="${2:-}"
HOST="${ORIGIN#https://}"
failures=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$expected', got '$actual'" >&2
    failures=$((failures + 1))
  fi
}

status() { curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }
location() { curl -sS -o /dev/null -w '%{redirect_url}' --max-time 15 "$1"; }

health="$(curl -sS --max-time 15 "$ORIGIN/api/health")"
check "health status" '"ok"' "$(sed -nE 's/.*"status":("[^"]*").*/\1/p' <<<"$health")"
if [[ -n "$EXPECTED_VERSION" ]]; then
  # Right after `rollout status` returns, old pods are still draining (preStop sleep) and Traefik may route a
  # few requests to them. Wait up to 90 s until 5 consecutive answers report the new version.
  version="" streak=0
  for _ in $(seq 1 45); do
    version="$(curl -sS --max-time 10 "$ORIGIN/api/health" | sed -nE 's/.*"version":("[^"]*").*/\1/p' || true)"
    if [[ "$version" == "\"$EXPECTED_VERSION\"" ]]; then
      streak=$((streak + 1))
      [[ $streak -ge 5 ]] && break
    else
      streak=0
    fi
    sleep 2
  done
  check "health version" "\"$EXPECTED_VERSION\"" "$version"
fi

check "homepage" 200 "$(status "$ORIGIN/")"
check "about page" 200 "$(status "$ORIGIN/about")"
check "rss feed" 200 "$(status "$ORIGIN/feed.xml")"
check "sitemap.xml" 200 "$(status "$ORIGIN/sitemap.xml")"
check "news-sitemap.xml" 200 "$(status "$ORIGIN/news-sitemap.xml")"
check "robots.txt lists sitemap" 1 "$(curl -sS --max-time 15 "$ORIGIN/robots.txt" | grep -c "^Sitemap: $ORIGIN/sitemap.xml$" || true)"
check "unknown page" 404 "$(status "$ORIGIN/this-page-does-not-exist")"
check "hijacked URL gone" 410 "$(status "$ORIGIN/category/cracks/")"
check "http -> https" "$ORIGIN/" "$(location "http://$HOST/")"
check "www -> apex" "$ORIGIN/blog" "$(location "https://www.$HOST/blog")"
check "argocd route untouched" 200 "$(status "$ORIGIN/argocd/")"

if ((failures > 0)); then
  echo "$failures smoke check(s) failed" >&2
  exit 1
fi
echo "all smoke checks passed"
