#!/usr/bin/env bash
# Renders every Kubernetes layer for one cluster into deploy/eks/clusters/<cluster>/<layer>/
# with images pinned by digest. Review the diff, commit it to your fork, and Argo CD syncs it.
#   deploy/eks/scripts/render.sh deploy/eks/env/<cluster>.env
. "$(dirname "$0")/lib.sh" "$1"
need kubectl envsubst
# RENDER_OFFLINE=1: CI/local validation without AWS, Terraform state or network. Uses fixed fake
# digests and outputs; the result is for schema/policy checks only, never for deployment.
if [ "${RENDER_OFFLINE:-0}" = 1 ]; then
  VPC_ID=vpc-00000000 KARPENTER_NODE_ROLE=${CLUSTER_NAME}-karpenter-node KARPENTER_QUEUE=$CLUSTER_NAME
  ECR_REGISTRY=111122223333.dkr.ecr.$AWS_REGION.amazonaws.com LOG_GROUP=/roboshop/$CLUSTER_NAME/containers
  export VPC_ID KARPENTER_NODE_ROLE KARPENTER_QUEUE ECR_REGISTRY LOG_GROUP
  ecr_digest() { echo "sha256:$(printf %064d 0)"; }
  hub_digest() { echo "sha256:$(printf %064d 1)"; }
else
  need aws curl jq terraform
  load_terraform_outputs
fi

OUT=${RENDER_OUT:-$EKS_DIR/clusters/$CLUSTER_NAME}
WORK=$(mktemp -d "$EKS_DIR/.render.XXXXXX"); trap 'rm -rf "$WORK"' EXIT

# Application images: ECR tag (commit SHA, immutable) -> digest.
[ "${RENDER_OFFLINE:-0}" = 1 ] || ecr_digest() {
  aws ecr describe-images --region "$AWS_REGION" --repository-name "$1" --image-ids imageTag="$IMAGE_TAG" \
    --query 'imageDetails[0].imageDigest' --output text
}
# Third-party images: anonymous Docker Hub registry API -> manifest-list digest (multi-arch).
[ "${RENDER_OFFLINE:-0}" = 1 ] || hub_digest() {
  local repo=$1 tag=$2 token
  token=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$repo:pull" | jq -r .token)
  curl -fsSI -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://registry-1.docker.io/v2/$repo/manifests/$tag" | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2}'
}

LAB_REGISTRY=881026659929.dkr.ecr.us-east-1.amazonaws.com   # image names in services/*.yaml
images=""
for svc in ai-gateway cart-service catalogue-service currency-service kafka-bridge mcp-server moks \
           payment-service shipping user-service web; do
  repo="$ECR_REPOSITORY_PREFIX-$svc"
  d=$(ecr_digest "$repo") || { echo "no image $repo:$IMAGE_TAG in $ECR_REGISTRY" >&2; exit 1; }
  images+="- name: $LAB_REGISTRY/roboshop-$svc
  newName: $ECR_REGISTRY/$repo
  digest: $d
"
done
for ref in library/mongo:8.2 library/redis:8.10-alpine library/rabbitmq:4.1-management-alpine \
           library/postgres:18-alpine apache/kafka:4.1.2; do
  repo=${ref%%:*}; tag=${ref#*:}; short=${repo#library/}
  d=$(hub_digest "$repo" "$tag"); [ -n "$d" ] || { echo "cannot resolve docker.io/$ref" >&2; exit 1; }
  images+="- name: $short
  newName: docker.io/$repo
  digest: $d
"
done

render_layer() {   # layer, source dir
  local layer=$1 src=$2
  mkdir -p "$WORK/$layer" "$OUT/$layer"
  cat > "$WORK/$layer/kustomization.yaml" <<KUST
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
- ../../$src
images:
$images
KUST
  kubectl kustomize --load-restrictor LoadRestrictionsNone "$WORK/$layer" | subst > "$OUT/$layer/manifests.yaml"
  grep -q '\${' "$OUT/$layer/manifests.yaml" && grep -n '\${[A-Z_]*}' "$OUT/$layer/manifests.yaml" | head -3 >&2 && {
    echo "unresolved variable in $layer" >&2; exit 1; } || true
  echo "rendered $layer ($(grep -c '^kind:' "$OUT/$layer/manifests.yaml") objects)"
}

render_layer platform               k8s/platform
render_layer karpenter              k8s/karpenter
render_layer secrets                k8s/secrets
render_layer tls                    k8s/tls
render_layer gatekeeper             k8s/gatekeeper
render_layer gatekeeper-constraints k8s/gatekeeper/constraints
render_layer istio                  k8s/istio
render_layer observability          k8s/observability
render_layer apps                   ../../argocd-eks/apps
render_layer keda                   k8s/keda
render_layer jobs                   k8s/jobs
render_layer argocd                 k8s/argocd

# Every application container must now reference a digest.
if grep -nE '^\s+image: ' "$OUT/apps/manifests.yaml" "$OUT/jobs/manifests.yaml" | grep -v '@sha256:'; then
  echo "some images are not pinned by digest" >&2; exit 1
fi
echo "Done: $OUT. Review with git diff, commit, push; Argo CD syncs (or kubectl apply per RUNBOOK)."
