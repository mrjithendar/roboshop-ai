# Prometheus at https://jithendar.com/prometheus/

From the repository root, with Traefik, public host routing and cert-manager already installed:

```bash
bash minikube/deploy-prometheus.sh
bash minikube/deploy-grafana.sh
```

The second command updates Grafana's provisioned Prometheus data source while preserving Grafana's password and volume. The installer follows the selected Minikube profile; use `KUBE_CONTEXT=YOUR_CONTEXT` on either command when working through a remote kubeconfig. Requires Helm, kubectl, Python 3, a default StorageClass and the Traefik Middleware CRDs. For a fresh cluster follow [Traefik setup](../traefik/README.md) first. DNS and public TCP 80/443 must reach the Vultr ingress controller.

## Login

Open **https://jithendar.com/prometheus/**. Username: **admin**. Retrieve the generated password:

```bash
kubectl -n robotshop-ai get secret prometheus-auth \
  -o jsonpath='{.data.password}' | base64 --decode; echo
```

Add `--context=YOUR_CONTEXT` if necessary. This password is separate from Grafana's. The installer reuses it on reruns and never prints the password itself.

## Deployment

- Namespace `robotshop-ai`, release and Service `prometheus`.
- Official image `prom/prometheus:v3.15.0`, one replica, 5 GiB PVC, 7-day/4 GB retention limits. The size limit applies to TSDB blocks, so the volume includes extra headroom for WAL/head data; monitor disk usage.
- Requests 100m CPU/256 MiB RAM; limits 1 CPU/768 MiB RAM. Higher scrape volume may require more resources.
- HTTPS ingress with `/prometheus` Prefix matching, the shared namespace-local `jithendar-com-tls` certificate, and Traefik BasicAuth. No prefix stripping. Grafana's `/grafana` and WordPress's `/` routes remain separate.
- Both `--web.external-url` and `--web.route-prefix` include `/prometheus`, including health checks and self-scraping. Admin/lifecycle APIs are not enabled.
- Public authentication is enforced at Traefik. Grafana uses `http://prometheus.robotshop-ai.svc.cluster.local:9090/prometheus` directly. Cluster-internal access is not authenticated by this setup. The authentication Secret uses Kubernetes' `kubernetes.io/basic-auth` format; anyone authorized to read that Secret can read its password.

Use HTTPS directly; this chart does not create an HTTP redirect. The deployment uses a single persistent instance suitable for the Minikube sandbox. Helm keeps the PVC on uninstall; deleting the namespace/cluster can still destroy metrics.

## Metrics and Grafana

Prometheus initially **scrapes itself only**. Check **Status → Target health**, or run `up` in its query interface. Installing Prometheus alone does not install node-exporter, kube-state-metrics, or instrument WordPress/MySQL/Redis.

Add actual cluster-reachable application/exporter endpoints under `extraScrapeConfigs` in `values.yaml`, then rerun the installer. For example, only if that Service and metrics endpoint exist:

```yaml
extraScrapeConfigs:
  - job_name: robotshop
    metrics_path: /metrics
    static_configs:
      - targets:
          - ai-gateway.robotshop-ai.svc.cluster.local:3000
```

The configuration checksum rolls the pod when scrape settings change. Docker Compose names/configuration are not automatically imported. `observability/prometheus/alerts.yml` is not installed by this minimal chart, and no Alertmanager is deployed.

After rerunning `deploy-grafana.sh`, Grafana has a provisioned default **Prometheus** data source (`robotshop-prometheus`). Use Explore and query `up`. Provisioning does not remove other manually added data sources; resolve any pre-existing conflicting default/name before provisioning. No dashboards are imported automatically.

## Troubleshooting

```bash
kubectl -n robotshop-ai get pods,pvc,svc,ingress
kubectl -n robotshop-ai logs deployment/prometheus --tail=100
kubectl -n robotshop-ai describe deployment prometheus
kubectl -n robotshop-ai get middleware prometheus-auth
kubectl -n robotshop-ai describe certificate jithendar-com
curl -I https://jithendar.com/prometheus/
# Authenticated test prompts for the password instead of putting it in shell history:
curl -u admin https://jithendar.com/prometheus/-/ready
```

An unauthenticated HTTP **401** is expected from the public endpoint. A **404** suggests missing ingress/path configuration; **503** usually means the pod is not ready. For a timeout or untrusted certificate follow the [cert-manager](../cert-manager/README.md) and [Traefik](../traefik/README.md) guides. PVC Pending means storage provisioning/capacity needs attention. Grafana connection failures often mean the data source omitted `/prometheus` or the server is not running.

Reference: [Prometheus URL flags](https://prometheus.io/docs/prometheus/latest/command-line/prometheus/), [Traefik BasicAuth](https://doc.traefik.io/traefik/v3.4/middlewares/http/basicauth/).
