# Metrics and alerts

Prometheus is deployed by the `prometheus` Argo CD Application from
[`minikube/monitoring/prometheus`](../../minikube/monitoring/prometheus/README.md).
Scrape jobs live in its `values.yaml` (`extraScrapeConfigs`) and alert rules in
`files/alerts.yml`. Rules are evaluated and shown under **Alerts**; no
Alertmanager is configured, so nothing is delivered externally.

Example query: `sum by (service) (rate(roboshop_http_requests_total[5m]))`.
