# Correlating a load run

The default lab disables exporters and cloud credentials. k6 emits bounded operation
names and sample trace IDs, never request bodies or session cookies. A load result
is not evidence that a trace exporter works. For tracing validation run the
existing Moks/widget/gateway distributed-tracing tests with local collectors.

For a separately instrumented **isolated** stack, propagate the generated W3C
traceparent through ingress, gateway, Moks, catalogue, user and payment services.
Search the sample trace ID in Jaeger/Tempo and, for AI observations, Langfuse. Keep
one trace per journey operation; inspect both primary and fallback spans rather
than counting a fallback as a separate successful user answer. Do not enable
prompt/body capture without checking the synthetic-data boundary.

Record these series alongside the k6 run window:

| Layer | Signals to inspect |
|---|---|
| Generator | CPU, RSS, open sockets, achieved vs offered iterations, dropped iterations |
| HTTP | per normalized route request rate, status, p95/p99, pending requests |
| Pods | CPU throttling, memory, OOM/restarts, readiness failures, replicas |
| MongoDB/PostgreSQL/Redis | pool waits, query latency, locks, connections, cache misses, eviction |
| Commerce | outstanding reservations, duplicate logical keys, outbox backlog/retries |
| AI | accepted requests, successful answers, actual provider/model, attempt latency, timeout/fallback reason, token usage when available |

Example Kubernetes resource diagnostics (explicit test context only):

```bash
kubectl --context=YOUR_TEST_CONTEXT -n roboshop-load-testing top pods
kubectl --context=YOUR_TEST_CONTEXT -n roboshop-load-testing get pods
```

Metrics Server is optional and is not installed by this harness. On a real test
stack use the existing service dashboards; this lab's single pod and MongoMock do
not produce meaningful database or multi-replica capacity measurements. Report
missing metrics as unavailable, never zero. If client latency rises with saturated
generator CPU but server time stays flat, move the generator to a separate host
before identifying the application as the bottleneck.

The widget intentionally omits token/cost/provider details. Obtain them from
sanitized server observations, not guesses from answer length. Mock costs are
zero; no inference-quality or paid-provider capacity claims follow from them.

## Existing application Prometheus queries

Use Grafana Explore against the existing Prometheus datasource. These names come
from service-local runtime exporters. Select the isolated scrape target/job when
sharing a datasource; never sum production and lab traffic together.

```promql
sum by (service, route, status) (rate(roboshop_http_requests_total[1m]))
sum by (service) (rate(roboshop_http_requests_total{status=~"5.."}[1m]))
sum by (service) (rate(roboshop_http_requests_total{status="429"}[1m]))
sum by (service) (rate(roboshop_http_duration_seconds_sum[1m]))
/
sum by (service) (rate(roboshop_http_duration_seconds_count[1m]))
```

The last query is **mean latency**, not p95: the current exporter exposes summary
sum/count without histogram buckets. Use k6 for observed client percentiles.
Where kube-state-metrics/cAdvisor are already scraped, use:

```promql
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="roboshop-load-testing",container!=""}[1m]))
sum by (pod) (container_memory_working_set_bytes{namespace="roboshop-load-testing",container!=""})
sum by (pod) (increase(kube_pod_container_status_restarts_total{namespace="roboshop-load-testing"}[5m]))
```

An empty result means the exporter or scrape may be absent, not zero consumption.
