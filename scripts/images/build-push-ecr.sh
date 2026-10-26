#!/usr/bin/env bash
# Builds each selected service from its own Docker context, then pushes :local.
# AWS_REGION and AWS_ACCOUNT_ID select the registry; repositories must already
# exist. A later failure leaves previously pushed images intact; rerunning is
# not an atomic release of all services. No infrastructure is created here.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Run on the Hetzner ARM64 host to produce ARM64 images for Minikube.
# Usage: bash build-push-ecr.sh [service ...]   (no arguments = all services)
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

case "${1:-}" in
  --help|-h) echo 'Usage: scripts/images/build-push-ecr.sh [--dry-run] [service ...]'; echo 'Requires Docker ARM64 and AWS CLI v2 (init docker + aws). AWS_REGION/AWS_ACCOUNT_ID select ECR. Builds and pushes :local.'; exit 0;;
esac
DRY_RUN=0
if [[ "${1:-}" == --dry-run ]]; then DRY_RUN=1; shift; fi
region="${AWS_REGION:-us-east-1}"
account="${AWS_ACCOUNT_ID:-881026659929}"
registry="$account.dkr.ecr.$region.amazonaws.com"
services=(ai-gateway cart-service catalogue-service currency-service
  frontend kafka-bridge mcp-server nginx payment-service
  shipping-service moks sre-copilot user-service)
if (( $# )); then services=("$@"); fi

# Validate service names before any remote write; shipping keeps its legacy ECR name.
repositories=()
for service in "${services[@]}"; do
  case "$service" in
    ai-gateway|cart-service|catalogue-service|currency-service|frontend|kafka-bridge|mcp-server|nginx|payment-service|shipping-service|moks|sre-copilot|user-service) ;;
    *) echo "Unknown service: $service" >&2; exit 1 ;;
  esac
  test -f "services/$service/Dockerfile"
  suffix="$service"
  [[ "$service" != shipping-service ]] || suffix=shipping
  repositories+=("roboshop-$suffix")
done
if [[ "$DRY_RUN" == 1 ]]; then
  printf 'Would build and push ARM64 :local images in %s: %s\n' "$registry" "${repositories[*]}"
  exit 0
fi
for tool in docker aws; do command -v "$tool" >/dev/null || { echo "Missing $tool; run init docker + aws profiles." >&2; exit 1; }; done
# Read the engine architecture rather than trusting DOCKER_DEFAULT_PLATFORM.
case "$(docker info --format '{{.Architecture}}')" in
  arm64|aarch64) platform=linux/arm64 ;;
  *) echo 'ARM64 Docker engine required; these images target ARM64 cluster nodes.' >&2; exit 1 ;;
esac
# Fail before building if Terraform has not created the selected repositories.
aws ecr describe-repositories --region "$region" --registry-id "$account" \
  --repository-names "${repositories[@]}" --query 'repositories[].repositoryName' --output text
aws ecr get-login-password --region "$region" |
  docker login --username AWS --password-stdin "$registry"

for index in "${!services[@]}"; do
  service="${services[$index]}"
  image="$registry/${repositories[$index]}:local"
  echo "Building $service -> $image ($platform)"
  docker build --platform "$platform" --pull -t "$image" "services/$service"
  docker push "$image"
done
echo "Done: pushed ${#services[@]} images tagged local for $platform."
echo 'Update the desired image in Git and sync its Application in Argo CD. deploy-minikube.sh manages the cluster only.'
