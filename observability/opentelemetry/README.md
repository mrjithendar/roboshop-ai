# Distributed tracing

Each HTTP service generates spans and propagates W3C traceparent to its dependencies.
The bounded, best-effort HTTP/JSON exporter uses OTEL_EXPORTER_OTLP_TRACES_ENDPOINT.
Compose wires the collector's OTLP receiver to Jaeger. Request IDs correlate structured
logs with traces. Bodies, prompts, cookies and credentials are not exported. The small
manual exporter drops exports when its in-flight bound is reached; it has no durable
retry queue. Replace with an official SDK/export pipeline for production telemetry.
