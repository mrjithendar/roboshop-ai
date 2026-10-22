#!/usr/bin/env bash
# Run on the Hetzner ARM64 host to produce ARM64 images for Minikube.
# Usage: bash build-push-ecr.sh [service ...]   (no arguments = all services)
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

region="${AWS_REGION:-us-east-1}"
account="${AWS_ACCOUNT_ID:-881026659929}"
registry="$account.dkr.ecr.$region.amazonaws.com"
services=(ai-gateway cart-service catalogue-service currency-service fastapi-demo
  finder frontend mcp-server nginx payment-service product-ingestion
  recommendation-service shipping-service shopping-agent sre-copilot user-service)
if (( $# )); then services=("$@"); fi

for tool in aws docker; do
  command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }
done
# Use the Docker engine architecture, ignoring stale DOCKER_DEFAULT_PLATFORM values.
case "$(docker info --format '{{.Architecture}}')" in
  arm64|aarch64) platform=linux/arm64 ;;
  amd64|x86_64) platform=linux/amd64 ;;
  *) echo 'Docker must run on ARM64 or AMD64.' >&2; exit 1 ;;
esac
repositories=()
for service in "${services[@]}"; do
  case "$service" in
    ai-gateway|cart-service|catalogue-service|currency-service|fastapi-demo|finder|frontend|mcp-server|nginx|payment-service|product-ingestion|recommendation-service|shipping-service|shopping-agent|sre-copilot|user-service) ;;
    *) echo "Unknown service: $service" >&2; exit 1 ;;
  esac
  test -f "services/$service/Dockerfile"
  suffix="$service"
  [[ "$service" != shipping-service ]] || suffix=shipping
  repositories+=("roboshop-$suffix")
done
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
echo 'Deploy these images with: bash deploy-minikube.sh [service ...]'
