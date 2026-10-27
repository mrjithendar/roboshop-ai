# Observability

All observability workloads are deployed by Argo CD from this directory. Argo CD
deploys the Git revision on `master`, so commit and push changes before syncing.

| Signal | Component | Argo CD Application | Namespace | Source |
| --- | --- | --- | --- | --- |
| Metrics | Prometheus 3.15 | `prometheus` | `monitoring` | [`prometheus/`](prometheus/README.md) (local Helm chart) |
| Dashboards | Grafana (community chart 14.0.1) | `grafana` | `monitoring` | [`grafana/values.yaml`](grafana/README.md) |
| Logs | Loki 3.7.9 + Alloy 1.21.2 | `loki` | `monitoring` | [`loki/`](loki/README.md) (Kustomize) |
| Traces | OpenTelemetry Collector 0.162 → Jaeger 2.22 | `otel-collector`, `jaeger` | `observability` | [`otel-collector/`](otel-collector/) (Kustomize), [`jaeger/`](jaeger/), [design notes](opentelemetry/README.md) |

```bash
./deploy-argocd.sh prometheus grafana loki otel-collector jaeger --context mk4
```

`deploy-argocd.sh` creates missing Applications but never edits existing ones.
After changing an Application's source path, update the live Application too
(`kubectl -n argocd apply -f argocd/<name>.yaml`, or patch `spec.source`).

## How the pieces connect

- **Prometheus** scrapes itself, kubelet/cAdvisor on every node, the RoboShop
  services' `/metrics` endpoints (job `roboshop`), Loki and Alloy. Alert rules in
  `prometheus/files/alerts.yml` are evaluated and shown under **Alerts**. No
  Alertmanager is installed, so alerts are not delivered anywhere.
- **Alloy** tails pod logs from `roboshop-ai`, `traefik` and `observability`
  through the Kubernetes API, keeps only sanitized `event`/`level`/`trace_id`
  fields, and pushes to Loki.
- **Grafana** has two provisioned datasources: Prometheus (default) and Loki.
- **Traces** go from services over OTLP/HTTP to
  `otel-collector.observability.svc.cluster.local:4318` (set in `roboshop-config`),
  which strips sensitive attributes and forwards to Jaeger. The collector's only
  configuration is [`otel-collector/collector.yaml`](otel-collector/collector.yaml);
  Kustomize turns it into a hash-named ConfigMap, so editing it rolls the collector.
  An `ExternalName` Service `roboshop-ai/otel-collector` keeps pods that still use
  the short name `otel-collector:4318` working; remove it once every RoboShop pod
  has restarted with the new endpoint. Jaeger storage is in-memory, with no ingress.

## Access

- Grafana: **https://jithendar.com/grafana/**
- Prometheus: **https://jithendar.com/prometheus/** (Traefik BasicAuth)
- Loki and Jaeger: cluster-internal only. Use Grafana Explore for logs, or
  `kubectl -n roboshop-ai port-forward svc/jaeger 16686` for the Jaeger UI.

TLS comes from the shared `jithendar/jithendar-com` Certificate, served to every
route through Traefik's default TLSStore (`shared-tls` Application). The monitoring
ingresses do not request their own certificates.

## Shared login Secret

Grafana and Prometheus share **`monitoring/monitoring-auth`** (type
`kubernetes.io/basic-auth`, keys `username`/`password`, username `admin`).
`./create-secrets.sh` creates it through [`credentials.py`](credentials.py),
reusing an existing Secret without rotating it. Grafana reads it as its initial
admin credential; Prometheus's Traefik Middleware uses it for BasicAuth.

```bash
kubectl --context mk4 -n monitoring get secret monitoring-auth \
  -o jsonpath='{.data.password}' | base64 --decode; echo
```

Grafana also stores the admin password in its database. After rotating the
Secret, run `python3 observability/credentials.py sync-grafana --context mk4`
to update user ID 1 (the password is passed over stdin, never as an argument).

## Verify

```bash
kubectl --context mk4 -n monitoring get pods,pvc
kubectl --context mk4 -n argocd get app prometheus grafana loki otel-collector jaeger
python3 -m pytest -q tests/test_loki.py tests/test_yaml_layout.py minikube/test-monitoring-credentials.py
```

In Prometheus, **Status → Target health** should show every target up. In
Grafana, **Explore → Loki** with `{namespace="roboshop-ai"}` should return lines.

## Data

Prometheus (5Gi, 7 days), Grafana (2Gi), Loki (10Gi, 7 days) and Alloy (1Gi
read positions) use PVCs that are kept when an Application is removed. Jaeger
traces are lost on restart. This is a single-node lab setup, not HA.
