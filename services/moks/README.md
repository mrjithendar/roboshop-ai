# Moks

**An AI agent for everyone.**

One Python process, one image (`roboshop-moks`) and one Kubernetes Deployment
(`moks`) serve the widget and the LangGraph/LangChain AI engine on port 4103.
The storefront embeds `/moks/widget.js`; `/finder/` remains a compatibility alias.
Public widget routes are `/widget.js`, `/available`, and `/chat`. The widget
requires a signed-in user and an allowed Origin. It calls the gateway to retain
central configuration and stock filtering, which calls the private engine routes.
Sixteen HTTP worker threads leave capacity for those callbacks while at most four
widget requests are in flight. The provider limit remains two concurrent calls.

Moks is optional: stopping it hides the closed widget without affecting shopping.
Readiness checks the catalogue only; availability diagnostics check the gateway
and user service, never Moks itself. Credentials and provider settings are unchanged.

## Upgrade from Finder and shopping-agent

Create the `roboshop-moks` ECR repository with the infrastructure Terraform before
building. Build/push `moks`, `nginx`, and `frontend`; deploy Moks before switching
the gateway configuration and proxy. Apply `minikube/roboshop/config.yaml` and
restart `ai-gateway` and `sre-copilot` to read `AGENT_URL=http://moks:4103`.
Once Moks and the new proxy/widget work, remove the obsolete Deployments and
Services with `kubectl -n roboshop-ai delete deployment,service finder shopping-agent --ignore-not-found`.
This is a deliberate operator step: deploying the new YAML does not delete old
workloads automatically. No credentials, provider configuration or user data is migrated.
Retain the old ECR repositories/images until rollback is no longer needed.

## Engine API

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

Run `docker build -t roboshop-moks:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).


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

## LangChain and LangGraph

Every configured chat now runs a LangGraph `StateGraph`:

```text
START → search_catalogue → ground_evidence → generate_answer → END
```

LangChain's `langchain-core` package provides `ChatPromptTemplate` and the runnable
pipeline used by the generation node. The provider runnable calls our existing
router; it does not introduce a second SDK path. This preserves workload IAM,
Ollama endpoint restrictions, configuration revision checks, disconnect, circuit
breaking, and the one-attempt fallback policy. No extra service, API key, hosted
LangGraph deployment, or LangSmith account is needed.

Catalogue retrieval stays deterministic: current stock, budget, archive status and
provenance filter the evidence. At most four matches are sent to the model.
Comparison and clarification remain grounded model responses, not autonomous
order-placement tools. The graph has no loops or retry policy. There is one
logical generation call; only the existing router may attempt the configured
fallback. The same request deadline is checked between graph stages and passed
through the existing network path.

Graph state is request-local and has no persistent checkpointer. It does not add
cross-request memory or resume conversations after restart. No database migration
is required. LangSmith automatic tracing is explicitly disabled around execution
to avoid exporting prompts, catalogue text or provider configuration through
ambient environment settings. Existing metadata-only OpenTelemetry/Langfuse
provider spans remain, with `agent.retrieve` and `agent.generate` parent spans.

Run offline regression tests from this service directory:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests
```

The Dockerfile runs these mocked-provider tests, so existing ECR CI and local image
builds fail before publication if they fail. Rebuild and deploy `moks`
to activate this change; the compatibility widget URL and gateway APIs remain unchanged.

## Build and deploy on the ARM64 host

```bash
# First create roboshop-moks via the infrastructure Terraform (review its plan).
bash build-push-ecr.sh moks nginx frontend
bash deploy-minikube.sh moks nginx frontend
```

The deployment script also updates only `AGENT_URL` in the existing ConfigMap and
restarts its gateway/SRE consumers. Secrets and all other configuration are preserved.
CI publishes `:latest`; the simple build/deploy scripts use `:local` by default.
Do not remove the old services until the replacement is ready and chat works.
No provider reconfiguration is needed. Langfuse/OpenTelemetry now identify this
workload as `moks`, so older traces remain under `shopping-agent`.

## Persistent conversations

For signed-in users, `/history` proxies the authenticated gateway history endpoint.
Only the `rs_auth` cookie is forwarded alongside service authorization; user IDs
and browser-supplied context cannot select or overwrite another account's history.
The gateway stores the latest 40 completed exchanges in MongoDB `chat_history`.
The widget reloads them when opened, and clears its display after logout. Recent
saved turns provide bounded follow-up context, including after a page refresh.
Unsent drafts and failed provider requests are not persisted. No MongoDB credential
is added to Moks; the gateway owns access to the collection.

## Conversation and authentication tracing

Public chat still accepts the same `message` (1–1,000 characters). The gateway
loads history for the authenticated account and sends separate `message` and
`history` fields to `/internal/chat`. Only the latest two turns and up to four
product SKU/slug references per turn are forwarded. Old internal messages using
`\nPrior conversation (untrusted):` remain readable during a rolling upgrade;
new structured requests never split the current question at that delimiter.
Upgrade Moks before the gateway so the receiver accepts the new history field.

Retrieval searches the current question only. For explicit follow-ups such as
“Which of those is cheaper?”, it restricts candidates to the latest saved product
references, resolved against the current catalogue. Legacy saved slugs also work.
Stock, archive, budget, currency and provenance rules still apply; historical
prices/descriptions are not catalogue evidence. No query-rewriting model call is
made. Follow-ups without resolvable references may need clarification.

Generation receives JSON containing the question, bounded untrusted history and
current evidence. `MOKS_HISTORY_MAX_CHARS` defaults to 4,000 (clamped to 0–8,000).
`MOKS_PROMPT_MAX_CHARS` defaults to 14,000 (clamped to 8,000–14,000) for system plus
human text; the existing provider limits of 2,000 system and 12,000 human characters
remain unchanged. These are character budgets, not tokenizer-exact token counts.
Old history is reduced first; oversized catalogue records are dropped whole so
price/currency/provenance fields cannot be partially cut. Product cards reflect
only evidence actually sent. The current question is never truncated. The gateway
also drops old history if JSON escaping would exceed the internal 16 KiB body cap.
History, user messages and catalogue content remain untrusted, not instructions.

Widget session authentication creates one `GET /api/auth/me` client span and
propagates W3C trace context, including unsampled decisions. Only `rs_auth` and
trace headers are forwarded: no arbitrary browser headers or other cookies.
Authentication retains its origin check, two-second timeout, 16 KiB response read
and no retries. Spans contain normalized routes and actual response statuses only;
no response means no HTTP status. Export failure cannot fail authentication.
