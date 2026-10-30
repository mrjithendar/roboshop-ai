#!/usr/bin/env bash
# D. Installs the cluster controllers with pinned Helm charts, in dependency order, onto the
# system node group. Idempotent (helm upgrade --install). Application layers come afterwards
# from Argo CD or kubectl (RUNBOOK.md). Requires: helm >= 3.8, kubectl, envsubst.
#   deploy/eks/platform/install.sh deploy/eks/env/<cluster>.env [component...]
. "$(dirname "$0")/../scripts/lib.sh" "$1"; shift
need helm kubectl envsubst terraform
load_terraform_outputs
VALUES="$EKS_DIR/platform/values"
CTX=$(kubectl config current-context)
case "$CTX" in *"$CLUSTER_NAME"*) ;; *) echo "kubectl context '$CTX' is not $CLUSTER_NAME; run the kubeconfig command from terraform output" >&2; exit 1;; esac

v() { subst < "$VALUES/$1"; }   # values with reader-specific variables substituted
up() { local rel=$1 ns=$2; shift 2; echo ">> $rel ($ns)"; helm upgrade --install "$rel" "$@" -n "$ns" --create-namespace --wait --timeout 10m; }

helm repo add eks https://aws.github.io/eks-charts >/dev/null
helm repo add jetstack https://charts.jetstack.io >/dev/null
helm repo add external-secrets https://charts.external-secrets.io >/dev/null
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
helm repo add istio https://istio-release.storage.googleapis.com/charts >/dev/null
helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts >/dev/null
helm repo add kedacore https://kedacore.github.io/charts >/dev/null
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts >/dev/null
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts >/dev/null
helm repo add argo https://argoproj.github.io/argo-helm >/dev/null
helm repo update >/dev/null

all="karpenter lbc cert-manager external-secrets monitoring istio gatekeeper keda observability argocd"
for c in ${*:-$all}; do
  case $c in
  karpenter)   # first: everything that is not a controller schedules onto Karpenter capacity.
    # ServiceMonitor CRDs do not exist yet; the monitoring step re-applies with them enabled.
    sm=false; kubectl get crd servicemonitors.monitoring.coreos.com >/dev/null 2>&1 && sm=true
    up karpenter kube-system oci://public.ecr.aws/karpenter/karpenter --version "$KARPENTER_VERSION" -f <(v karpenter.yaml) --set serviceMonitor.enabled=$sm ;;
  lbc)         # before any Service of type LoadBalancer exists
    up aws-load-balancer-controller kube-system eks/aws-load-balancer-controller --version "$AWS_LBC_CHART_VERSION" -f <(v aws-load-balancer-controller.yaml) ;;
  cert-manager)
    up cert-manager cert-manager jetstack/cert-manager --version "$CERT_MANAGER_VERSION" -f <(v cert-manager.yaml) ;;
  external-secrets)
    up external-secrets external-secrets external-secrets/external-secrets --version "$EXTERNAL_SECRETS_VERSION" -f <(v external-secrets.yaml) ;;
  monitoring)  # provides the ServiceMonitor/PodMonitor CRDs that later charts reference
    up kube-prometheus-stack monitoring prometheus-community/kube-prometheus-stack --version "$KUBE_PROMETHEUS_STACK_VERSION" -f <(v kube-prometheus-stack.yaml)
    up karpenter kube-system oci://public.ecr.aws/karpenter/karpenter --version "$KARPENTER_VERSION" -f <(v karpenter.yaml) ;;
  istio)
    up istio-base istio-system istio/base --version "$ISTIO_VERSION"
    up istiod istio-system istio/istiod --version "$ISTIO_VERSION" -f <(v istio-istiod.yaml)
    up istio-cni istio-system istio/cni --version "$ISTIO_VERSION" -f <(v istio-cni.yaml)
    kubectl get ns istio-ingress >/dev/null 2>&1 || kubectl create ns istio-ingress
    kubectl label ns istio-ingress istio-injection=enabled --overwrite
    up istio-ingressgateway istio-ingress istio/gateway --version "$ISTIO_VERSION" -f <(v istio-gateway.yaml) ;;
  gatekeeper)
    up gatekeeper gatekeeper-system gatekeeper/gatekeeper --version "$GATEKEEPER_VERSION" -f <(v gatekeeper.yaml) ;;
  keda)
    up keda keda kedacore/keda --version "$KEDA_VERSION" -f <(v keda.yaml) ;;
  observability)
    up jaeger observability jaegertracing/jaeger --version "$JAEGER_CHART_VERSION" -f <(v jaeger.yaml)
    up otel-agent observability open-telemetry/opentelemetry-collector --version "$OTEL_COLLECTOR_CHART_VERSION" -f <(v otel-agent.yaml) ;;
  argocd)
    up argocd argocd argo/argo-cd --version "$ARGOCD_CHART_VERSION" -f <(v argocd.yaml) ;;
  *) echo "unknown component: $c" >&2; exit 1 ;;
  esac
done
echo "Platform ready. Next: RUNBOOK.md step D3 (secrets) / E (data)."
