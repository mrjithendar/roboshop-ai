#!/usr/bin/env bash
# Deploy jithendar.com to the mk4 cluster.
#
#   sites/deploy.sh               # deploy the most recently pushed image in ECR
#   sites/deploy.sh <commit-sha>  # deploy the image built from a specific commit (e.g. to roll back)
#
# CI only builds and pushes jithendar-com:<commit-sha> to ECR. This script looks up the image's
# digest, pins it in deploy/production/kustomization.yaml, applies, waits and smoke-tests.
# Run from the roboshop-ai repository root. Commit the updated kustomization.yaml afterwards
# so Git records what is live.
# Started as `sh sites/deploy.sh`? Re-run under full bash (macOS sh is bash in POSIX mode).
if [ -z "${BASH_VERSION:-}" ] || case ":${SHELLOPTS:-}:" in *:posix:*) true ;; *) false ;; esac; then
  exec bash "$0" "$@"
fi
set -euo pipefail

# Use the first AWS CLI that actually runs (an Intel-only copy fails on Apple Silicon without Rosetta).
AWS=""
for candidate in $(type -ap aws) /opt/homebrew/bin/aws /usr/local/bin/aws; do
  if "$candidate" --version >/dev/null 2>&1; then AWS="$candidate"; break; fi
done
[[ -n "$AWS" ]] || { echo "No working AWS CLI found. Install it with: brew install awscli" >&2; exit 1; }

CONTEXT="${KUBE_CONTEXT:-mk4}"
REGION="${AWS_REGION:-us-east-1}"
REPOSITORY="jithendar-com"
SITE="sites/jithendar-com"
SHA="${1:-}"

cd "$(git rev-parse --show-toplevel)"

if [[ -z "$SHA" ]]; then
  echo "→ Finding the most recently pushed image in ECR ($REGION)"
  LATEST="$("$AWS" ecr describe-images --region "$REGION" --repository-name "$REPOSITORY" \
    --filter tagStatus=TAGGED --query 'sort_by(imageDetails,&imagePushedAt)[-1].[imageTags[0],imageDigest,imagePushedAt]' --output text)"
  read -r SHA DIGEST PUSHED <<<"$LATEST"
  [[ -n "${SHA:-}" && "$SHA" != "None" ]] || { echo "No tagged images in $REPOSITORY." >&2; exit 1; }
  echo "  latest: $SHA (pushed $PUSHED)"
else
  echo "→ Looking up $REPOSITORY:$SHA in ECR ($REGION)"
  if ! DIGEST="$("$AWS" ecr describe-images --region "$REGION" --repository-name "$REPOSITORY" \
    --image-ids imageTag="$SHA" --query 'imageDetails[0].imageDigest' --output text 2>/dev/null)" || [[ "$DIGEST" == "None" || -z "$DIGEST" ]]; then
    echo "No image tagged $SHA. Has CI finished building that commit (and is it pushed)?" >&2
    exit 1
  fi
fi
REGISTRY="$("$AWS" ecr describe-repositories --region "$REGION" --repository-names "$REPOSITORY" --query 'repositories[0].repositoryUri' --output text)"

echo "→ Pinning $REGISTRY@$DIGEST"
"$SITE/scripts/set-image.sh" "$REGISTRY" "$DIGEST"
grep -A3 '^images:' "$SITE/deploy/production/kustomization.yaml"

echo "→ Checking Secrets"
for s in jithendar-postgres jithendar-redis jithendar-com-env; do
  kubectl --context "$CONTEXT" -n jithendar get secret "$s" >/dev/null 2>&1 || {
    echo "Secret jithendar/$s is missing. Run $SITE/scripts/create-secrets.sh once first." >&2
    exit 1
  }
done

echo "→ Validating against the cluster"
kubectl --context "$CONTEXT" apply -k "$SITE/deploy/production" --dry-run=server >/dev/null

echo "→ Applying"
kubectl --context "$CONTEXT" apply -k "$SITE/deploy/production"

echo "→ Waiting for Postgres and Redis"
kubectl --context "$CONTEXT" -n jithendar rollout status statefulset/jithendar-postgres --timeout=5m
kubectl --context "$CONTEXT" -n jithendar rollout status deployment/jithendar-redis --timeout=3m

echo "→ Waiting for the site"
if ! kubectl --context "$CONTEXT" -n jithendar rollout status deployment/jithendar-com --timeout=5m; then
  kubectl --context "$CONTEXT" -n jithendar get pods -l app=jithendar-com -o wide || true
  echo "Rollout failed; rolling back to the previous version." >&2
  kubectl --context "$CONTEXT" -n jithendar rollout undo deployment/jithendar-com
  exit 1
fi

echo "→ Smoke test"
"$SITE/scripts/smoke.sh" https://jithendar.com "$SHA"

echo "✓ Deployed $SHA. Commit $SITE/deploy/production/kustomization.yaml to record it."

# Until the first admin exists, show how to finish setup (the token is useless afterwards, so it is not printed again).
if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://jithendar.com/setup)" == "200" ]]; then
  echo
  echo "Setup is pending: open https://jithendar.com/setup and create the admin account."
  echo "One-time setup token (not a password; you choose the admin password on that page):"
  kubectl --context "$CONTEXT" -n jithendar get secret jithendar-com-env -o jsonpath='{.data.ADMIN_BOOTSTRAP_TOKEN}' | base64 -d
  echo
fi

