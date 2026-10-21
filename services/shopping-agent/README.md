# Python shopping agent

The agent owns all LLM calls. Private `POST /internal/chat` and
`POST /internal/llm/test` require `LLM_SERVICE_TOKEN` from the gateway. `/health`
and `/metrics` remain available internally on port 4103. `/api/chat` on this
service is rejected; customers use the gateway's `/api/chat`.

The gateway owns MongoDB provider configuration and sends a validated snapshot
and revision per request. The agent has no MongoDB connection. `agent.py` keeps
catalogue retrieval, budgets and stock filtering; only a selected Bedrock or
Ollama provider can generate chat answers. Unconfigured and unavailable states
never masquerade as generated recommendations. Legacy OpenAI variables are ignored.

Adapters use Bedrock Converse and Ollama `/api/chat` (non-streaming). Requests
have a 16-second retrieval/inference budget, 600-token output limit (32 for tests),
and two concurrent provider calls per process. Explicitly enabled Ollama-to-Bedrock
failover allows one fallback after an eligible transport failure; each attempt is
capped at six seconds. Direct modes remain supported. A per-replica circuit breaker
opens after three failures for 30 seconds, then permits one half-open recovery call. Ollama has an
explicit pinned-IP allowlist, 4096-token context and a 64 KiB response cap.
OpenTelemetry and optional Langfuse record metadata only, never prompts or outputs.

See [LLM operator setup](../../docs/deployment/llm-providers.md) for workload
identity, endpoint provisioning, activation, timeouts and verification commands.
Install `requirements.txt` and run `python server.py` for native operation.
The Dockerfile remains non-root and includes all provider modules via `*.py`.

## Independent service build

Run `docker build -t roboshop-shopping-agent:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).


`/health` is process-only liveness; `/ready` probes catalogue readiness with a
one-second timeout. Models are selected per request, so readiness never invokes a
model. Provider failures are explicit feature errors through the gateway/Finder;
they do not prevent administration of provider settings or storefront readiness.

Set `AI_GATEWAY_URL` (default `http://ai-gateway:3000`) for authoritative revision
checks before every generation attempt. Config changes/disconnect block subsequent
attempts; already-authorized remote work may finish. Background non-generating
provider diagnostics are cached at authenticated `/internal/llm/readiness`.
They do not gate pod readiness or trigger fallback by themselves. Enabled policies
must successfully test both providers before the gateway commits them.
