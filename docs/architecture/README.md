# Architecture

```mermaid
flowchart LR
  Browser[Responsive storefront] --> Gateway[AI gateway :3000]
  Gateway --> Catalog[Catalogue + ingestion + recommendations :4108]
  Catalog --> Mongo[(MongoDB products)]
  Gateway --> Agent[Shopping agent :4103]
  Gateway --> Payment[Payment service :4105]
  Payment --> Razorpay[Razorpay Orders and Payments API]
  Gateway --> Ops[Read-only SRE copilot :4104]
  Gateway --> Ledger[(Single-writer order ledger)]
  Agent --> Catalog
  Agent -. selected by superadmin .-> LLM[Bedrock Converse or approved Ollama]
  MCP[Stdio MCP client adapter] --> Recs
  MCP --> Ops
  Services[HTTP service spans] --> Collector[OTLP collector]
  Collector --> Jaeger[Jaeger]
  Prometheus[Prometheus] --> Metrics[Service metrics]
  Agent -. optional .-> Langfuse[Langfuse OTLP endpoint]
```

Only the gateway is exposed for application traffic. Browser requests are same-origin.
The catalogue owns insert-only startup imports and reads the MongoDB products collection. Recommendations and
assistant retrieval use that snapshot; the gateway supplies its sold-out exclusions.
Carts, stock decrements and idempotent payment orders are atomically saved in one JSON
file by one gateway process. The legacy account/payment services are independent.

All services expose liveness and metrics. Gateway readiness checks SRE health probes
for its dependencies. Traces propagate across internal HTTP calls; the manual exporter
is best-effort. SRE guidance is deterministic and non-mutating. MCP uses FastMCP: stdio for local clients and authenticated Streamable HTTP
on the internal Kubernetes Service. No public ingress is configured. Model outputs are guidance only and cannot execute tools.

Razorpay checkout uses stock reservations, signature validation, captured-payment checks,
and signed webhook/status recovery. The legacy dummy payment route is not exposed.
