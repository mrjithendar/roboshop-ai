# Shared by the scripts in this directory: loads env/<cluster>.env and Terraform outputs.
# Usage inside a script:  . "$(dirname "$0")/lib.sh" "$1"
set -euo pipefail

EKS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO_ROOT=$(cd "$EKS_DIR/../.." && pwd)

env_file=${1:?usage: $0 env/<cluster>.env}
[ -f "$env_file" ] || { echo "env file not found: $env_file" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$env_file"
# shellcheck disable=SC1091
. "$EKS_DIR/platform/versions.env"
set +a

tf_out() { terraform -chdir="$EKS_DIR/terraform" output -raw "$1"; }

load_terraform_outputs() {
  local name
  name=$(tf_out cluster_name)
  [ "$name" = "$CLUSTER_NAME" ] || { echo "CLUSTER_NAME=$CLUSTER_NAME but terraform state is for $name" >&2; exit 1; }
  [ "$(tf_out region)" = "$AWS_REGION" ] || { echo "AWS_REGION does not match terraform region" >&2; exit 1; }
  VPC_ID=$(tf_out vpc_id)
  KARPENTER_NODE_ROLE=$(tf_out karpenter_node_role_name)
  KARPENTER_QUEUE=$(tf_out karpenter_interruption_queue)
  ECR_REGISTRY=$(tf_out ecr_registry)
  LOG_GROUP=$(tf_out application_log_group)
  export VPC_ID KARPENTER_NODE_ROLE KARPENTER_QUEUE ECR_REGISTRY LOG_GROUP
}

# Only these variables are substituted; $(VAR) Kubernetes references and ${1} regex groups stay.
SUBST_VARS='${CLUSTER_NAME} ${AWS_REGION} ${ENVIRONMENT} ${OWNER} ${PUBLIC_HOST} ${ACME_EMAIL}
${ROUTE53_ZONE_ID} ${CERT_ISSUER} ${INGRESS_SOURCE_CIDR} ${IMAGE_TAG} ${MTLS_MODE}
${AUTHZ_DRY_RUN} ${POLICY_ACTION} ${TRACE_SAMPLING_PERCENT} ${GIT_REPO_URL} ${GIT_REVISION}
${SECRETS_PREFIX} ${VPC_ID} ${KARPENTER_NODE_ROLE} ${KARPENTER_QUEUE} ${ECR_REGISTRY}
${LOG_GROUP} ${ISTIO_VERSION}'
subst() { envsubst "$SUBST_VARS"; }

need() { for t in "$@"; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }; done; }
