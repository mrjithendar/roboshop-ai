#!/usr/bin/env bash
# H/J. Post-deployment checks. Read-only. Prints PASS/FAIL per check; never prints secret values.
#   deploy/eks/scripts/verify.sh deploy/eks/env/<cluster>.env
. "$(dirname "$0")/lib.sh" "$1"
need kubectl curl
fail=0
ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }
chk() { local d=$1; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }

chk "system nodes Ready" bash -c "kubectl get nodes -l roboshop.dev/pool=system --no-headers | grep -qv NotReady"
chk "Karpenter NodePools Ready" bash -c "kubectl get nodepools -o jsonpath='{.items[*].status.conditions[?(@.type==\"Ready\")].status}' | grep -qv False"
chk "roboshop-secrets synced" kubectl -n roboshop-ai wait externalsecret/roboshop-secrets --for=condition=Ready --timeout=10s
chk "all roboshop-ai Deployments available" kubectl -n roboshop-ai wait deploy --all --for=condition=Available --timeout=60s
chk "all roboshop-ai StatefulSets ready" bash -c "kubectl -n roboshop-ai get sts -o jsonpath='{range .items[*]}{.status.readyReplicas}/{.spec.replicas} {end}' | grep -vE '(^| )(0|)/'"
chk "every app pod has an istio-proxy" bash -c "! kubectl -n roboshop-ai get pods -l 'app,!sidecar.istio.io/inject' -o jsonpath='{range .items[*]}{.metadata.name} {.spec.initContainers[*].name} {.spec.containers[*].name}{\"\\n\"}{end}' | grep -v istio-proxy | grep -q ."
chk "certificate Ready" kubectl -n istio-ingress wait certificate/roboshop --for=condition=Ready --timeout=10s
chk "NLB provisioned" bash -c "kubectl -n istio-ingress get svc istio-ingressgateway -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' | grep -q elb"
chk "https://$PUBLIC_HOST/ returns 200" bash -c "curl -fsS -o /dev/null --max-time 15 https://$PUBLIC_HOST/"
chk "http redirects to https" bash -c "curl -sS -o /dev/null -w '%{http_code}' http://$PUBLIC_HOST/ | grep -q 301"
chk "API readiness via public edge" bash -c "curl -fsS --max-time 15 https://$PUBLIC_HOST/api/ready"
chk "ScaledObject Ready" kubectl -n roboshop-ai wait scaledobject/shipping-worker --for=condition=Ready --timeout=10s
chk "no HPA besides KEDA's on shipping-worker" bash -c "[ \$(kubectl -n roboshop-ai get hpa -o jsonpath='{range .items[*]}{.spec.scaleTargetRef.name}{\"\\n\"}{end}' | grep -c '^shipping-worker$') -eq 1 ]"
chk "Gatekeeper constraints present" bash -c "kubectl get constraints --no-headers | grep -q ."
echo "Gatekeeper audit (violations per constraint):"
kubectl get constraints -o custom-columns=NAME:.metadata.name,ACTION:.spec.enforcementAction,VIOLATIONS:.status.totalViolations 2>/dev/null || true
chk "otel-agent running on every node" bash -c "[ \$(kubectl -n observability get ds otel-agent -o jsonpath='{.status.numberReady}') = \$(kubectl get nodes --no-headers | wc -l | tr -d ' ') ]"
chk "Prometheus scraping mesh pods" bash -c "kubectl -n monitoring get podmonitor roboshop-mesh"
exit $fail
