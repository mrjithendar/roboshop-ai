#!/usr/bin/env bash
# Update an existing installation using images pushed by build-push-ecr.sh.
# Usage: bash deploy-minikube.sh [service ...]  (no arguments = all app services)
# Overrides: KUBE_CONTEXT=mk4 IMAGE_TAG=local AWS_REGION=us-east-1 AWS_ACCOUNT_ID=...
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

context="${KUBE_CONTEXT:-mk4}"
region="${AWS_REGION:-us-east-1}"
account="${AWS_ACCOUNT_ID:-881026659929}"
tag="${IMAGE_TAG:-local}"
registry="$account.dkr.ecr.$region.amazonaws.com"
services=(ai-gateway cart-service catalogue-service currency-service
  frontend kafka-bridge mcp-server nginx payment-service product-ingestion
  recommendation-service shipping-service moks sre-copilot user-service)
if (( $# )); then services=("$@"); fi
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash deploy-minikube.sh [service ...] (default: all application services)'
  echo 'Defaults: KUBE_CONTEXT=mk4 IMAGE_TAG=local; uses your existing kubeconfig.'
  echo 'Requires an initialized installation. Applies and restarts; does not wait for readiness.'
  exit 0
fi
for tool in kubectl aws python3; do
  command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }
done
[[ "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || { echo 'Invalid IMAGE_TAG.' >&2; exit 1; }
for service in "${services[@]}"; do
  case "$service" in
    ai-gateway|cart-service|catalogue-service|currency-service|frontend|kafka-bridge|mcp-server|nginx|payment-service|product-ingestion|recommendation-service|shipping-service|moks|sre-copilot|user-service) ;;
    *) echo "Unknown application service: $service" >&2; exit 1 ;;
  esac
  test -f "services/$service/$service-minikube.yaml"
done
kube=(kubectl --context="$context" --request-timeout=60s -n roboshop-ai)
# Initialize missing admin keys; preserve all existing passwords.
python3 minikube/roboshop/deployment.py credentials --context="$context"
# Preserve application credentials and database configuration.
"${kube[@]}" get secret roboshop-secrets -o name
"${kube[@]}" get configmap roboshop-config -o name

# ECR pull tokens expire after 12 hours. Refresh without printing the token.
aws ecr get-authorization-token --region "$region" --registry-ids "$account" \
  --query 'authorizationData[0].authorizationToken' --output text |
  python3 -c 'import base64,json,sys; token=sys.stdin.read().strip(); assert token and token != "None", "Missing ECR token"; config=json.dumps({"auths":{sys.argv[1]:{"auth":token}}}); print(json.dumps({"apiVersion":"v1","kind":"Secret","metadata":{"name":"ecr-pull","namespace":"roboshop-ai"},"type":"kubernetes.io/dockerconfigjson","data":{".dockerconfigjson":base64.b64encode(config.encode()).decode()}}))' "$registry" |
  "${kube[@]}" apply --server-side --field-manager=roboshop-ecr -f -

# Render image overrides before apply; never briefly deploy the manifest's old tag.
tmpdir=$(mktemp -d)
trap 'rm -rf -- "$tmpdir"' EXIT
for service in "${services[@]}"; do
  suffix="$service"
  [[ "$service" != shipping-service ]] || suffix=shipping
  cp "services/$service/$service-minikube.yaml" "$tmpdir/service.yaml"
  cat > "$tmpdir/kustomization.yaml" <<YAML
resources:
  - service.yaml
images:
  - name: 881026659929.dkr.ecr.us-east-1.amazonaws.com/roboshop-$suffix
    newName: $registry/roboshop-$suffix
    newTag: "$tag"
YAML
  echo "Deploying $service -> $registry/roboshop-$suffix:$tag (context $context)"
  "${kube[@]}" apply -k "$tmpdir"
  workload="deployment/$service"
  [[ "$service" != kafka-bridge ]] || workload=statefulset/kafka
  "${kube[@]}" rollout restart "$workload"
done
# A renamed service also needs its consumers to read the new endpoint.
if [[ " ${services[*]} " == *" moks "* ]]; then
  "${kube[@]}" patch configmap roboshop-config --type=merge -p '{"data":{"AGENT_URL":"http://moks:4103"}}'
  "${kube[@]}" rollout restart deployment/ai-gateway deployment/sre-copilot
fi
echo 'Applied manifests and requested restarts. Readiness has not been checked.'
