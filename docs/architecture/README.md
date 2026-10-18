# Architecture

```mermaid
flowchart LR
  Browser[Responsive storefront] --> Gateway[AI gateway :3000]
  Gateway --> Catalog[Product ingestion :4101]
  Gateway --> Recs[Recommendations :4102]
  Gateway --> Agent[Shopping agent :4103]
  Gateway --> Payment[Payment service :4105]
  Payment --> Razorpay[Razorpay Orders and Payments API]
  Gateway --> Ops[Read-only SRE copilot :4104]
  Gateway --> Ledger[(Single-writer order ledger)]
  Recs --> Catalog
  Agent --> Catalog
  Agent -. optional .-> OpenAI[OpenAI Responses API]
  MCP[Stdio MCP client adapter] --> Recs
  MCP --> Ops
  Services[HTTP service spans] --> Collector[OTLP collector]
  Collector --> Jaeger[Jaeger]
  Prometheus[Prometheus] --> Metrics[Service metrics]
  Agent -. optional .-> Langfuse[Langfuse OTLP endpoint]
```

Only the gateway is exposed for application traffic. Browser requests are same-origin.
The catalogue is an imported immutable-at-runtime JSON snapshot. Recommendations and
assistant retrieval use that snapshot; the gateway supplies its sold-out exclusions.
Carts, stock decrements and idempotent payment orders are atomically saved in one JSON
file by one gateway process. The legacy account/payment services are independent.

All services expose liveness and metrics. Gateway readiness checks SRE health probes
for its dependencies. Traces propagate across internal HTTP calls; the manual exporter
is best-effort. SRE guidance is deterministic and non-mutating. MCP is stdio, not a
public HTTP endpoint. Model outputs are guidance only and cannot execute tools.

Razorpay checkout uses stock reservations, signature validation, captured-payment checks,
and signed webhook/status recovery. The legacy dummy payment route is not exposed.
