#!/usr/bin/env bash
# Build every active application image. Run from any directory.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_PREFIX="${IMAGE_PREFIX:-robotshop}"
IMAGE_TAG="${IMAGE_TAG:-local}"
DRY_RUN=false
BUILD_OPTIONS=()
usage() {
  cat <<'EOF'
Usage: ./build-images.sh [--dry-run] [--pull] [--no-cache] [--platform PLATFORM]

Builds all nine application images using their service-specific Dockerfiles.
Environment (export the same values when running Docker Compose):
  IMAGE_PREFIX  Image repository prefix, e.g. registry.example.com/team/robotshop
                Default: robotshop
  IMAGE_TAG     Image tag. Default: local

--dry-run prints the exact build commands without requiring Docker.
--pull refreshes base images; --no-cache disables the build cache.
Infrastructure services use official images and are pulled by Compose as needed.
No images are pushed and no containers are started.
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --pull|--no-cache) BUILD_OPTIONS+=("$1"); shift ;;
    --platform)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { echo 'Missing --platform value.' >&2; exit 2; }
      BUILD_OPTIONS+=("--platform" "$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$IMAGE_TAG" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || { echo 'Invalid IMAGE_TAG.' >&2; exit 2; }
[[ "$IMAGE_PREFIX" =~ ^[a-z0-9]([a-z0-9./:_-]*[a-z0-9])?$ && "$IMAGE_PREFIX" != */ ]] || { echo 'Invalid IMAGE_PREFIX (use a lowercase repository prefix).' >&2; exit 2; }
services=(ai-gateway product-ingestion recommendation-service shopping-agent sre-copilot payment-service mcp-server shipping-service nginx)
for service in "${services[@]}"; do
  [[ -f "$ROOT/services/$service/Dockerfile" ]] || { echo "Missing Dockerfile for $service." >&2; exit 1; }
done
if [[ "$DRY_RUN" == false ]]; then
  command -v docker >/dev/null || { echo 'Docker is not installed.' >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo 'Docker daemon is unavailable. Start Docker and retry.' >&2; exit 1; }
fi
for service in "${services[@]}"; do
  suffix="$service"
  [[ "$service" != shipping-service ]] || suffix=shipping
  image="$IMAGE_PREFIX-$suffix:$IMAGE_TAG"
  command=(docker build "${BUILD_OPTIONS[@]}" --file "$ROOT/services/$service/Dockerfile" --tag "$image" "$ROOT")
  printf '\nBuilding %s\n' "$image"
  if [[ "$DRY_RUN" == true ]]; then
    printf '%q ' "${command[@]}"; printf '\n'
  else
    "${command[@]}"
  fi
done
if [[ "$DRY_RUN" == false ]]; then
  printf '\nBuilt all %s application images. Start them from %q with:\n' "${#services[@]}" "$ROOT"
  printf 'IMAGE_PREFIX=%q IMAGE_TAG=%q docker compose up -d\n' "$IMAGE_PREFIX" "$IMAGE_TAG"
fi
