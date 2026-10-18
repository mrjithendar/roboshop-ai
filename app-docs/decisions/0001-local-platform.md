# ADR 0001: Incremental local modernization

Status: accepted for this implementation, 2026-10-18.

Preserve legacy sources and introduce a separate modern storefront and service layer.
Use Node.js 24+ built-ins to keep the demo runnable without package installation;
retain explicit service boundaries for ingestion, ranking, assistant and operations.
The UI uses browser modules and native dialogs rather than retaining AngularJS.

Start with transparent keyword/synonym retrieval and optional Responses API synthesis.
Do not label deterministic retrieval as AI. Do not let model text mutate carts or
infrastructure. Keep authoritative prices, stock and orders outside the model.

Use a single-writer atomic JSON ledger for a portable demo. This deliberately limits
horizontal scaling; a transactional database is required for production. No user
account or real checkout integration is implied. Preserve EUR prices and image assets.

Provide Prometheus metrics, W3C trace propagation and OTLP/HTTP JSON spans. The manual
exporter is bounded and best-effort, without durable buffering. A production deployment
should adopt official telemetry SDKs and durable storage. Langfuse is opt-in.

References: [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses),
[OTLP](https://opentelemetry.io/docs/specs/otlp/),
[MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
