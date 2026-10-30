#!/usr/bin/env bash
# I. Controlled scaling test: proves queue backlog -> KEDA -> HPA -> Pending pods -> Karpenter
# node, WITHOUT touching real order data. It uses a throwaway queue (roboshop.keda.backlog-test)
# and a throwaway Deployment in namespace keda-backlog-test, then removes both.
# shipping-worker itself is never fed synthetic events: they would fail its fail-closed checks
# and land in the dead-letter queue.
#   deploy/eks/scripts/backlog-test.sh deploy/eks/env/<cluster>.env [messages]
. "$(dirname "$0")/lib.sh" "$1"
need kubectl curl jq
N=${2:-60}; NS=keda-backlog-test; Q=roboshop.keda.backlog-test

pw=$(kubectl -n roboshop-ai get secret roboshop-secrets -o jsonpath='{.data.RABBITMQ_PASSWORD}' | base64 -d)
kubectl -n roboshop-ai port-forward svc/rabbitmq 15672:15672 >/dev/null 2>&1 & pf=$!
cleanup() {
  curl -fsS -u "roboshop:$pw" -X DELETE "http://127.0.0.1:15672/api/queues/%2F/$Q" >/dev/null 2>&1 || true
  kill $pf 2>/dev/null || true
  kubectl delete ns $NS --ignore-not-found --wait=false >/dev/null
  echo "Cleaned up queue $Q and namespace $NS. Karpenter consolidates the extra node(s) after ~5 min."
}
trap cleanup EXIT
sleep 3

kubectl create ns $NS --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# Same monitoring-only credentials KEDA uses for the real worker.
kubectl -n roboshop-ai get secret keda-rabbitmq -o json \
  | jq '{apiVersion, kind, type, data, metadata: {name: .metadata.name, namespace: "'$NS'"}}' | kubectl apply -f - >/dev/null
kubectl apply -f - >/dev/null <<YAML
apiVersion: apps/v1
kind: Deployment
metadata: {name: backlog-consumer, namespace: $NS}
spec:
  replicas: 0
  selector: {matchLabels: {app: backlog-consumer}}
  template:
    metadata: {labels: {app: backlog-consumer}}
    spec:
      automountServiceAccountToken: false
      securityContext: {runAsNonRoot: true, runAsUser: 65534, seccompProfile: {type: RuntimeDefault}}
      tolerations: [{key: roboshop.dev/spot, operator: Equal, value: "true", effect: NoSchedule}]
      containers:
      - name: sleep
        image: public.ecr.aws/docker/library/busybox:1.38.0
        command: ["sleep", "3600"]
        resources: {requests: {cpu: 900m, memory: 64Mi}, limits: {memory: 64Mi}}
        securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}
---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata: {name: rabbitmq-monitor, namespace: $NS}
spec:
  secretTargetRef: [{parameter: host, name: keda-rabbitmq, key: host}]
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: {name: backlog-consumer, namespace: $NS}
spec:
  scaleTargetRef: {name: backlog-consumer}
  minReplicaCount: 0
  maxReplicaCount: 6
  pollingInterval: 10
  cooldownPeriod: 30
  triggers:
  - type: rabbitmq
    authenticationRef: {name: rabbitmq-monitor}
    metadata: {protocol: http, queueName: $Q, vhostName: /, mode: QueueLength, value: "10"}
YAML

curl -fsS -u "roboshop:$pw" -X PUT -H 'content-type: application/json' \
  -d '{"durable":false,"auto_delete":false}' "http://127.0.0.1:15672/api/queues/%2F/$Q" >/dev/null
for i in $(seq 1 "$N"); do
  curl -fsS -u "roboshop:$pw" -H 'content-type: application/json' \
    -d "{\"properties\":{},\"routing_key\":\"$Q\",\"payload\":\"backlog-test-$i\",\"payload_encoding\":\"string\"}" \
    "http://127.0.0.1:15672/api/exchanges/%2F/amq.default/publish" >/dev/null
done
echo "Published $N messages to $Q (expect ~$(( (N + 9) / 10 )) replicas, capped at 6)."

for t in $(seq 1 30); do
  sleep 10
  r=$(kubectl -n $NS get deploy backlog-consumer -o jsonpath='{.status.replicas}')
  p=$(kubectl -n $NS get pods --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l | tr -d ' ')
  n=$(kubectl get nodeclaims --no-headers 2>/dev/null | wc -l | tr -d ' ')
  echo "t+$((t*10))s replicas=${r:-0} pending=$p nodeclaims=$n"
  ready=$(kubectl -n $NS get deploy backlog-consumer -o jsonpath='{.status.readyReplicas}')
  [ "${ready:-0}" -ge 6 ] && break
done
kubectl -n $NS get hpa,scaledobject
kubectl get nodeclaims -o custom-columns=NAME:.metadata.name,POOL:.metadata.labels.karpenter\\.sh/nodepool,TYPE:.metadata.labels.node\\.kubernetes\\.io/instance-type,CAPACITY:.metadata.labels.karpenter\\.sh/capacity-type,READY:.status.conditions[-1].status
