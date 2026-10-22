# Distributed tracing

## Coverage

| Workload | Trace coverage |
| --- | --- |
| Python gateway | HTTP server/client spans, MongoDB auth/customer operations, paid-event producer |
| Python shopping agent | HTTP server/client spans, catalogue calls, model call and usage attributes; optional Langfuse |
| Python MCP | Tool execution and gateway client spans; tool arguments/results excluded |
| Node ingestion | HTTP server and MongoDB command spans; statements/documents excluded |
| Node recommendations, SRE | HTTP server and downstream client spans |
| Node payments | HTTP server and Razorpay client spans; payment bodies/IDs/signatures excluded |
| Java shipping | Spring Boot OpenTelemetry HTTP and Rabbit listener observations |

Python and Node use explicit bounded OTLP/HTTP JSON instrumentation. Java uses
Spring Boot's OpenTelemetry starter and Micrometer bridge, exporting OTLP protobuf.
The collector accepts both. Existing `/metrics` endpoints remain scraped by
Prometheus; this change does not replace them with OTLP metrics or export application
logs through OTLP. NGINX serves frontend assets and forwards W3C trace headers; its
access logs correlate to the gateway's trace ID, but the standard NGINX image does
not generate an edge span. Database/cache/broker daemons are infrastructure, not
instrumented application runtimes. Browser click/session replay is not enabled.

A paid event stores the originating `traceparent` in the durable outbox. Publishing
creates a PRODUCER span and sends a W3C `traceparent` RabbitMQ header. Shipping's
observed listener extracts it, creating the consumer span in the same trace.
Retries can produce multiple spans for the same event; delivery remains at least
once and shipping deduplicates event IDs. Do not add customer IDs or addresses to
message tracing headers.

## Privacy and operational limits

Application spans use fixed operation names and bounded route groups. They omit
customer IP addresses, emails, customer IDs, request/response bodies, cookies, credentials,
SQL/Mongo queries, shipping addresses and AI prompts. The collector removes common
URL/query/client-address and query-text attributes as a second layer. Adding new
instrumentation still requires checking its attributes; this filter is not a
universal PII detector. Account metadata belongs in MongoDB, not traces.

`OTEL_SERVICE_VERSION` and `DEPLOYMENT_ENVIRONMENT` label resources. Incoming valid
W3C trace context and sampling flags propagate; invalid/all-zero IDs are rejected.
The explicit Python/Node exporters use bounded queues and short timeouts; telemetry
failure must not fail checkout. They drop telemetry when full or unreachable.
The collector handles batching/retries; durable collector queues and secured remote
export endpoints remain deployment concerns. HTTP health/metrics probes are omitted
from Python/Node server traces. Java keeps its framework observation behavior.

Tests assert spans from all eight application services, client spans, RabbitMQ
producer/consumer correlation, and the absence of customer data in emitted payloads.

References: [OTLP encoding](https://opentelemetry.io/docs/specs/otlp/),
[Spring Boot tracing](https://docs.spring.io/spring-boot/reference/actuator/tracing.html),
[Spring AMQP observations](https://docs.spring.io/spring-amqp/reference/amqp/receiving-messages/micrometer-observation.html).


## Operational pod logs

Tracing is complemented by stdout operational events. Rebuild and deploy the changed
service images before expecting these new records; no logging infrastructure or paid
service is needed. Telemetry export may be disabled and pod logs still work.

Python services and Node services keep their logger inside each service directory.
Their JSON records include timestamp, level, service, event, traceId (when part of a
request), method, safe route group, status and durationMs. Downstream HTTP records name
the dependency host and report failures/latency without URL credentials or query text.
Only allowlisted metadata is accepted by the runtime log helper.

Useful events:

- `ai_not_configured`: a superadmin must connect a provider.
- `llm_attempt_started/completed/failed`: actual provider/model, duration and safe error
  code; `llm_failover_selected` explains a timeout, transient error or open breaker.
- `checkout_reserved`, `checkout_reused`, `checkout_provider_order_attached`,
  `checkout_reconciliation_required`, `checkout_payment_captured`: explain checkout
  progress without logging prices, payment signatures, addresses or customer identities.
- `order_event_published`, `order_event_delivery_pending`, `purchase_history_projected`,
  `customer_history_sync_pending`: show background delivery/projection and retries.
- `dependency_response_rejected`, `dependency_call_completed`, `request_rejected`,
  `request_failed`: distinguish rejected input, authorization, downstream and internal
  failures. Exception **types**, never exception messages or raw stack locals, are logged.

`LOG_LEVEL=INFO` is the default. Python/Node runtime services support DEBUG/INFO/WARN/ERROR;
DEBUG includes successful readiness probes. Finder, FastAPI demo, Go currency and shipping
also support log-level filtering (successful probes in Go/Java/demo remain suppressed).
The shipping filter emits SLF4J key/value records with trace IDs. Go uses JSON slog records.
Frontend NGINX now emits access events to stdout; edge NGINX adds upstream connect/response
timing and the gateway request ID. Successful edge health probes are suppressed. NGINX
configuration controls its logs rather than LOG_LEVEL. Databases, Redis, RabbitMQ, Jaeger
and the collector retain their native operational logs; query/wire debug logging was not
enabled. Do not enable database statement logging to troubleshoot normal application flows.

The application records omit bodies, query strings, raw prompts/answers, passwords, cookies,
authorization headers and payment secrets. Trace IDs and internal order IDs are operational
correlation identifiers: restrict log access and retention. This does not change third-party
framework/native error logging policies. Never paste secrets into LOG_LEVEL or debug settings.

Read an individual service:

```bash
kubectl -n roboshop-ai logs deployment/ai-gateway --since=10m --follow
kubectl -n roboshop-ai logs deployment/shopping-agent --since=10m --follow
kubectl -n roboshop-ai logs deployment/frontend --since=10m --follow
# Last crashed container:
kubectl -n roboshop-ai logs deployment/ai-gateway --previous --tail=100
```

Readable filtering when jq is installed:

```bash
kubectl -n roboshop-ai logs deployment/ai-gateway --since=10m |
  jq -R 'fromjson? | select(.level == "WARN" or .level == "ERROR")'
# Replace TRACE_ID with the traceId in a failed request; no credentials needed.
kubectl -n roboshop-ai logs deployment/shopping-agent --since=10m |
  jq -R 'fromjson? | select(.traceId == "TRACE_ID")'
```

For a temporary increase in probe visibility (changes the deployment and restarts pods):

```bash
kubectl -n roboshop-ai set env deployment/ai-gateway LOG_LEVEL=DEBUG
# Return to normal afterwards:
kubectl -n roboshop-ai set env deployment/ai-gateway LOG_LEVEL=INFO
```

No DEBUG setting enables prompt/body/credential logging. Existing deployments were not
changed while implementing or testing this feature.
