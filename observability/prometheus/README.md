# Metrics and alerts

Compose scrapes `/metrics` on all five services every 15 seconds. The metrics include
request counts by bounded route/status and aggregate request duration sum/count.
Health and scrape requests are excluded. `alerts.yml` defines service-down and >10%
5xx-ratio alerts. Prometheus displays alert state; outbound notifications require an
Alertmanager configuration, which is not included.

Example query: `sum by (service) (rate(robotshop_http_requests_total[5m]))`.
