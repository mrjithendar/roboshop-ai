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
have a 12-second caller deadline, 600-token output limit (32 for tests), two
concurrent calls per process, and no cross-provider fallback. Ollama has an
explicit pinned-IP allowlist, 4096-token context and a 64 KiB response cap.
OpenTelemetry and optional Langfuse record metadata only, never prompts or outputs.

See [LLM operator setup](../../docs/deployment/llm-providers.md) for workload
identity, endpoint provisioning, activation, timeouts and verification commands.
Install `requirements.txt` and run `python server.py` for native operation.
The Dockerfile remains non-root and includes all provider modules via `*.py`.

## Independent service build

Run `docker build -t robotshop-shopping-agent:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).
