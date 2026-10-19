# Distributed tracing

Compose configures every HTTP application service to export to
`http://otel-collector:4318/v1/traces`. The collector batches traces and exports them
to Jaeger. Build application images with `./build-images.sh`, then start the stack using `docker compose up -d`; browse
`http://localhost:16686` and select a service. This command starts the application's
configured databases/services too. Native development uses
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces` with a running
collector. Helm expects an existing collector; set `otelTracesEndpoint` to its
reachable URL rather than leaving the default if your service has a different name.

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

Use `docker compose --profile tools run --rm -T mcp-server` for a traced stdio MCP
process; inject an authenticated `MCP_SESSION_TOKEN` only for protected tools.
The MCP service is optional and has no published ports. Never connect a browser
directly to the collector or embed a collector credential in frontend code.

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
