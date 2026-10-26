#!/usr/bin/env bash
# Register the catalog without syncing newly adopted workloads.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
command="${1:-status}"
case "$command" in
  validate) exec "${PYTHON:-python3}" scripts/argocd/validate.py "${@:2}" ;;
  bootstrap|status) ;;
  *) echo 'Usage: scripts/argocd.sh validate [--external-charts] | bootstrap | status' >&2; exit 2 ;;
esac
context="${ARGOCD_CONTEXT:-${OPENCLAW_CONTEXT:-}}"
[[ -n "$context" ]] || { echo 'Set ARGOCD_CONTEXT to the intended current Kubernetes context.' >&2; exit 1; }
[[ "$(kubectl config current-context)" == "$context" ]] || { echo 'Context mismatch; no context was changed.' >&2; exit 1; }
if [[ "$command" == status ]]; then
  exec kubectl --context "$context" --request-timeout=30s get applications -n argocd
fi
# Argo reads GitHub, not local files. Do not register unresolved local sources.
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit and push the reviewed catalog and source changes before bootstrap; working tree is not clean.' >&2; exit 1; }
remote_head="$(git ls-remote https://github.com/mrjithendar/roboshop-ai.git refs/heads/master | cut -f1)"
[[ -n "$remote_head" && "$(git rev-parse HEAD)" == "$remote_head" ]] || { echo 'Check out the published master revision before bootstrap. No Applications changed.' >&2; exit 1; }
"${PYTHON:-python3}" scripts/argocd/validate.py
# Preserve OpenClaw's existing gated setup; this catalog is not a bypass.
[[ -n "$(kubectl --context "$context" --request-timeout=30s get application openclaw -n argocd --ignore-not-found -o name)" ]] || { echo 'First run scripts/openclaw.sh bootstrap to satisfy OpenClaw prerequisites.' >&2; exit 1; }
kubectl --context "$context" --request-timeout=30s apply -k argocd
echo 'Applications registered. New applications use manual sync; review each diff before its first sync. OpenClaw retains its existing automatic sync policy.'
