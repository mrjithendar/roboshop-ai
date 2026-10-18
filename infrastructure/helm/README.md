# Demo Kubernetes chart

`robotshop-ai/` deploys six services with ClusterIP networking, non-root containers,
resource limits, health probes, and a persistent single-writer gateway ledger.
Build/push the root Dockerfile and set `image.repository` and `image.tag` to your image.

```sh
helm lint infrastructure/helm/robotshop-ai
helm template robotshop infrastructure/helm/robotshop-ai
helm upgrade --install robotshop infrastructure/helm/robotshop-ai --namespace robotshop-ai --create-namespace --set image.repository=YOUR-REGISTRY/robotshop-ai --set image.tag=YOUR-TAG
kubectl -n robotshop-ai port-forward service/robotshop-ai-gateway 3000:3000
```

The commands above are operator instructions; no cluster deployment was performed.
A default storage class is required unless persistence.storageClass is set. The chart
does not expose an Ingress or install observability backends. Set otelTracesEndpoint
to your collector. To enable AI, pre-create an agent Secret and set agentSecretName
and aiEnabled. Keep gateway replicas at one until the JSON ledger is replaced.
