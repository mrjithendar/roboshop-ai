#!/usr/bin/env bash
# Apply each service's *-minikube.yaml in dependency order.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
load_images=false
render_output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --load-images) load_images=true; shift ;;
    --render-only)
      [[ $# -ge 2 && "$2" != --* ]] || fail '--render-only needs an output directory.'
      render_output="$2"; shift 2 ;;
    -h|--help)
      echo 'Usage: bash deploy-minikube.sh [--load-images] [--render-only DIR]'
      echo 'Deploys 16 RobotShop services into robotshop-ai. Does not reset any existing application.'
      echo 'Overrides: PROFILE=mk4, KUBE_CONTEXT, IMAGE_PREFIX=robotshop, PUBLIC_ORIGIN=https://jithendar.com'
      echo 'Application images always use :local; exported IMAGE_TAG is ignored.'
      echo '--load-images: run on the Minikube host after build-images.sh; load application images into the selected profile.'
      echo '--render-only DIR: validate/render YAML without any cluster access.'
      exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
command -v python3 >/dev/null || fail 'Python 3 is required.'
python3 -c 'import yaml' 2>/dev/null || fail 'PyYAML is required: python3 -m pip install PyYAML (use a virtual environment).'
if [[ -n "$render_output" ]]; then
  [[ "$load_images" == false ]] || fail 'Use --render-only separately from --load-images.'
  python3 "$ROOT/minikube/robotshop/deployment.py" render --output "$render_output"
  echo "Manifests rendered in $render_output. No cluster changes made."
  exit 0
fi
# Prefer the downloaded Vultr config without changing the caller's shell.
# An explicit KUBECONFIG always takes precedence; otherwise fall back to kubectl defaults.
if [[ -z "${KUBECONFIG:-}" && -f "$HOME/.kube/vultr-minikube.json" ]]; then
  export KUBECONFIG="$HOME/.kube/vultr-minikube.json"
fi
command -v kubectl >/dev/null || fail 'kubectl is required.'
PROFILE="${PROFILE:-mk4}"
[[ "$PROFILE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid PROFILE.'
state="${MINIKUBE_HOME:-$HOME/.minikube}/robotshop-installer/$PROFILE.profile"
if [[ -f "$state" ]]; then PROFILE="$(cat "$state")"; fi
KUBE_CONTEXT="${KUBE_CONTEXT:-$PROFILE}"
[[ "$KUBE_CONTEXT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid KUBE_CONTEXT.'
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
python3 "$ROOT/minikube/robotshop/deployment.py" render --output "$temp"
k --request-timeout=15s get namespace kube-system >/dev/null
k --request-timeout=15s get ingressclass traefik >/dev/null || fail 'Install Traefik first.'
k --request-timeout=15s get crd middlewares.traefik.io >/dev/null
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s
if [[ "$load_images" == true ]]; then
  [[ "$KUBE_CONTEXT" == "$PROFILE" ]] || fail '--load-images requires the selected local profile and context to match.'
  command -v minikube >/dev/null || fail 'minikube is required for --load-images; run on the Minikube host.'
  command -v docker >/dev/null || fail 'Docker is required to load locally built images.'
  while IFS= read -r image; do
    docker image inspect "$image" >/dev/null 2>&1 || fail "Missing local image $image. Run bash build-images.sh first."
  done < "$temp/images.txt"
  minikube -p "$PROFILE" status >/dev/null
  while IFS= read -r image; do
    echo "Loading $image into $PROFILE..."
    minikube -p "$PROFILE" image load --daemon --overwrite=true "$image"
  done < "$temp/images.txt"
fi
echo "Deploying RobotShop into context=$KUBE_CONTEXT namespace=robotshop-ai"
k apply -f "$temp/config.yaml"
python3 "$ROOT/minikube/robotshop/deployment.py" credentials --context "$KUBE_CONTEXT"
services=(mongodb postgres redis rabbitmq jaeger otel-collector product-ingestion recommendation-service shopping-agent sre-copilot payment-service shipping-service ai-gateway frontend nginx mcp-server)
for service in "${services[@]}"; do
  echo "Deploying $service..."
  k apply -f "$temp/$service-minikube.yaml"
  workload="deployment/$service"
  [[ "$service" != postgres ]] || workload=deployment/shipping-db
  [[ "$service" != rabbitmq ]] || workload=statefulset/rabbitmq
  # A mutable :local tag leaves the pod template unchanged after a rebuild.
  if [[ "$load_images" == true && -f "$ROOT/services/$service/Dockerfile" ]]; then
    k -n robotshop-ai rollout restart "$workload"
  fi
  if ! k -n robotshop-ai rollout status "$workload" --timeout=10m; then
    name="${workload#*/}"
    k --request-timeout=15s -n robotshop-ai get pods,pvc || true
    k --request-timeout=15s -n robotshop-ai describe pods -l "app=$name" || true
    k --request-timeout=15s -n robotshop-ai logs "$workload" --all-containers=true --tail=60 --pod-running-timeout=10s || true
    fail "$service did not become ready. Fix the reported problem and rerun; data and credentials are preserved."
  fi
done
k -n robotshop-ai get pods,svc,pvc
k apply -f "$temp/ingress.yaml"
if ! k -n robotshop-ai wait --for=condition=Ready certificate/jithendar-com --timeout=180s; then
  k -n robotshop-ai get certificate,certificaterequest,order,challenge
  fail 'TLS is pending. Check DNS and public ports 80/443, then rerun.'
fi
echo 'RobotShop: https://jithendar.com/roboshop/'
