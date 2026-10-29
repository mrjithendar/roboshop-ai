# RoboShop MCP server

A FastMCP 4.1.3 server (MCP Python SDK 2.3.0) that lets AI clients search, compare and shop
the RoboShop catalogue on behalf of a signed-in user. It is private by default: a ClusterIP
Service with no ingress.

## Boundaries

```
MCP client (Claude, IDE, script) --MCP: stdio or Streamable HTTP /mcp--> mcp-server
mcp-server --HTTP with the caller's own rs_auth session--> ai-gateway --> user, catalogue, cart, shipping services
browser widget --> moks --> ai-gateway /api/chat --> moks /internal/chat  (no MCP on this path)
```

- **mcp-server** owns protocol, discovery, argument and output validation, confirmation
  prompts, deadlines and admission limits. It holds no business data and no privileged
  credentials.
- **ai-gateway and the services behind it** remain authoritative. Every tool call carries the
  caller's own session and is authorized there again, including cart ownership, roles,
  optimistic product revisions and the protected super admin.
- **Moks (the shopping assistant) does not use MCP.** It calls catalogue-service and the
  gateway's private `/internal/*` routes directly over HTTP, and the gateway calls Moks for
  `/api/chat`. Routing Moks through MCP would create a gateway → Moks → MCP → gateway loop
  and add a hop without adding authorization, so that path is unchanged.
- Tools never take URLs, SQL, shell commands or payment actions. There are no tools for order
  placement, payment capture, refunds, deletion or infrastructure.

## Transports and authentication

| Transport | Used by | Identity | Discovery |
|---|---|---|---|
| Streamable HTTP, `POST /mcp`, stateless, JSON responses | Kubernetes (`MCP_TRANSPORT=http`, port 4107) | `Authorization: Bearer <rs_auth session>` per request, checked against `/api/auth/me` on every request with no cache | Filtered by role |
| stdio | Local clients launching `server.py` | Optional `MCP_SESSION_TOKEN` injected by the local client | All tools listed; the gateway rejects what the session may not do |

- **Opaque sessions, not OAuth.** The bearer token is an ordinary RoboShop session. Expired,
  revoked or disabled sessions fail on the next request.
- **Never sent:** this is not an OAuth authorization server, and it does not proxy client
  headers or cookies.
- **Gateway headers:** each gateway request carries exactly `accept`, `cookie: rs_auth=<that
  caller's session>` and trace headers. `origin` is added only on writes, for the gateway's
  CSRF check.
- **Remote AI clients:** a remote client (outside the cluster or over the internet) needs MCP
  authorization with OAuth 2.1 against an external identity provider, plus TLS. That requires
  an external IdP. It is not implemented here; do not expose `/mcp` publicly without it.
- **DNS-rebinding guard:** `/mcp`, `/health` and `/ready` reject an unknown `Host` with 421 and
  an unknown `Origin` with 403. Allowed hosts are `MCP_ALLOWED_HOSTS`, plus localhost and the
  pod's own address (used by kubelet probes). No browser origins are allowed unless
  `MCP_ALLOWED_ORIGINS` is set.
- **Request limits:** request bodies over 256 KiB get 413. Uvicorn accepts at most 64
  concurrent connections.
- **Stateless sessions:** no server-side MCP session state can leak between users.

## Tool catalogue

Every tool has a strict input schema with no unknown fields, no type coercion, bounded sizes
and no control characters. Every tool also declares an output schema, and its result is
validated before being returned.

Absent facts stay `null` rather than becoming `0` or `""`: `inStock: 0` means sold out, while
`inStock: null` means stock was not reported.

Products keep their SKU, currency, price type and a `provenance` object with these fields:
- `collection`
- `fulfilment`
- `demo`
- `synthetic`
- `showcase`
- `sourceKind`
- `priceBasis`
- `priceCheckedAt`
- `sources`

`observedAt` records when live stock was read.

### Read tools

All read tools are read-only, idempotent and closed-world. A read tool is retried once, and
only after a connection failure, a read timeout or a 502/503/504, within the same deadline.

| Tool | Inputs | Output | Roles over HTTP |
|---|---|---|---|
| `search_products` | `query` (1–300), optional `category`, `budget` (0–1,000,000), `limit` (1–10) | `products[]`, `resultCount`, `strategy`, `observedAt` | any signed-in user |
| `compare_products` | `skus`: 2–4 unique SKUs | `products[]`, `currency`, `lowestPrice`, `comparable`, `priceComparisonPolicy`, `observedAt` | any signed-in user |
| `shipping_countries` | none | `countries[] {code, name, cityCount}`, `source`, `license` | any signed-in user |
| `shipping_cities` | `country` (ISO alpha-2), `q` (2–80) | `cities[] {id, name, region, countryCode}` | any signed-in user |
| `service_health` | none | `status`, `dependencies` (gateway `/api/ready`) | any signed-in user |
| `personalized_recommendations` | none | `products[]`, `basis`, `currency`, `observedAt` | customer, admin, superadmin |
| `view_cart` | none | cart: `items[]`, `subtotal`, `shippingCost`, `total`, `currency`, `observedAt` | customer, admin, superadmin |
| `admin_list_products` | optional `after` (SKU), `limit` (1–100) | `products[]` with `revision`, `stockEditable`, `nextAfter` | admin, superadmin |
| `admin_list_users` | optional `after` (user id) | `users[] {id, email, name, role, disabled}`, `next` | superadmin |
| `admin_get_settings` | none | the four public settings | superadmin |

Notes:
- `lowestPrice` is null unless currency, price type and collection all match.
- `shippingCost` is null until a shipping quote is selected.
- Over stdio there is no role filtering; the gateway enforces the roles.

### Write tools

| Tool | Inputs | Roles | Side effect | Retry and duplicate handling |
|---|---|---|---|---|
| `update_cart` | `sku`, `quantity` (0–20; 0 removes) | customer, admin, superadmin | Sets one line in the caller's own cart. No stock reservation, payment or order. | Set semantics, so `idempotentHint` is true. Never retried by the server. A pending payment or insufficient stock returns `conflict`. |
| `admin_create_product` † | `sku`, `name`, `description`, `price` (INR), `instock`, `categories`, optional `archived` | admin, superadmin | Adds a product | A duplicate SKU returns `conflict`. Never retried. |
| `admin_update_product` † | the product fields above plus `revision` | admin, superadmin | Replaces editable fields | A stale `revision` returns `conflict`. Refresh with `admin_list_products`; do not retry blindly. |
| `admin_set_user_access` † | `userId`, `role` (customer or admin), `disabled` | superadmin | Changes a role or disables an account, which signs that user out | Set semantics. The super admin returns `conflict`. |
| `admin_update_settings` † | `storeName`, `announcement`, `supportEmail`, `checkoutEnabled` | superadmin | Replaces public settings; `checkoutEnabled: false` stops new checkouts | Set semantics. Cannot touch secrets. |

† **Not registered unless `MCP_ENABLE_ADMIN_WRITES=true`.** The default deployment and the
demo expose no admin writes; use the admin console. When enabled, each call needs the
confirmation described next.

Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are hints
for clients. They are not security controls.

### Confirmation for admin writes

A boolean argument chosen by the model is never accepted as confirmation. Instead:

1. **First call:** returns an elicitation request (MCP 2026-07-28 multi-round-trip input).
   It shows the user a summary such as "Update product X (revision 3): price …?". With it
   comes a request state that names the caller, the tool, a hash of the exact arguments, a
   two-minute expiry and a one-time nonce. The server signs the state with HMAC, and the SDK
   seals it again.
2. **Retry:** the client asks its user and retries. The server proceeds only if all of these
   hold:
   - the state verifies;
   - it is unexpired and unused;
   - it matches the same identity and arguments;
   - the answer is `accept` with `confirm: true`.

   Any change to the arguments needs a new confirmation.
3. **Older connections:** handshake-era (2025-11-25) connections use a server-initiated
   elicitation instead, where the transport has a back-channel (stdio).
4. **No way to ask:** if the client cannot ask its user, the call fails with
   `confirmation_unavailable` (or the client reports that elicitation is unsupported), and
   nothing is written.

This proves the confirmation came through the authenticated client for those exact
arguments. It cannot prove a human clicked, which is why admin writes are opt-in. The nonce
store is per process, so use one replica if admin writes are enabled, or set a shared
`MCP_CONFIRMATION_KEY` and accept per-replica replay windows.

## Errors

- **Protocol-level failures** come back as JSON-RPC errors: malformed JSON-RPC and missing
  `initialize`.
- **Unknown or unauthorized tools** come back as an `isError` result reading "Unknown tool".
  FastMCP chooses this deliberately (it matches the v1 SDK), although the spec lists unknown
  tools as protocol errors. The tool's existence is not revealed either way.
- **Everything else** is a tool execution error (`isError: true`) whose structured content is
  `{"error": {code, message, retryable, detail?, correlationId?}}`:

| `code` | Meaning |
|---|---|
| `invalid_argument` | Failed the input schema, or the gateway rejected the values |
| `unauthenticated` | Session missing, expired or revoked |
| `forbidden` | Signed in, but the role is not allowed |
| `not_found` | Unknown SKU, user or record |
| `conflict` | Stale revision, duplicate SKU, insufficient stock, pending payment, protected account |
| `rate_limited` | Per-user admission limit (60 calls/min) or 32 in-flight calls, or a gateway 429 |
| `dependency_unavailable` | Gateway or service down, or a 5xx |
| `invalid_response` | Malformed, non-JSON or over-1 MiB response, or output failing its schema |
| `timeout` | No answer within the 10 s tool deadline |
| `confirmation_required`, `confirmation_declined`, `confirmation_unavailable` | Admin write not confirmed |

- **`detail`:** only the gateway's own public message for a 400, 404 or 409. Internal URLs,
  stack traces and upstream text are never returned.
- **`correlationId`:** the trace ID, which equals the gateway's `X-Request-ID` when propagated.
- **`retryable`:** never true for writes.
- **Cancellation:** a write the client cancels runs to its deadline and is not replayed.

## Observability

- **Spans:** one W3C trace runs through the client's `traceparent` and:
  - `POST /mcp` (transport span, server kind)
  - session check `GET /api/auth/me` (client)
  - `mcp.call_tool` (FastMCP's native server span) with `gen_ai.tool.name`, `mcp.tool.outcome` and `error.type`
  - `GET /api/...` (client)
  - the gateway

  `traceparent`, `tracestate` and the sampled flag are propagated. Unsampled requests export
  nothing but still propagate.
- **Names and attributes:** names are stable (`mcp.call_tool`, `mcp.list_tools`,
  `mcp.initialize`). Attributes come from an allowlist, so arguments, session IDs and user IDs
  are never exported. Unknown tool names become `unknown`.
- **Logs:** `mcp_tool_completed` records `operation`, `outcome` (including
  `admission_rejected`) and `durationMs`. `dependency_retry_scheduled` records retries. Logs
  never contain arguments or sessions.
- **Failure isolation:** spans export to `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` through the
  service's bounded queue. Exporter failures and `OTEL_SDK_DISABLED=true` never affect a tool
  call.
- **Not exported to Langfuse:** these are not LLM generations, and Langfuse export stays
  limited to Moks.
- **Health:**
  - `/health` is liveness only, with no dependency calls.
  - `/ready` checks the gateway's `/health/ready` within 2 s, caches the result for 5 s, and
    returns 503 when the gateway is unavailable.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` (`http` in the image) | Transport |
| `GATEWAY_URL` | `http://127.0.0.1:3000` | Internal gateway URL |
| `PUBLIC_ORIGIN` | `http://localhost:3000` | Origin the gateway expects on writes |
| `MCP_SESSION_TOKEN` | none | stdio only; ignored over HTTP |
| `MCP_ALLOWED_HOSTS` | cluster Service names | Allowed `Host` values for HTTP |
| `MCP_ALLOWED_ORIGINS` | none | Browser origins allowed to call `/mcp` |
| `MCP_ENABLE_ADMIN_WRITES` | `false` | Registers admin write tools, which then require confirmation |
| `MCP_CONFIRMATION_KEY` | random per process | HMAC key for confirmation state |
| `MCP_TOOL_DEADLINE_SECONDS` | `10` | Total budget per tool call, retries included |
| `MCP_CALLS_PER_MINUTE`, `MCP_MAX_IN_FLIGHT` | `60`, `32` | Admission limits |
| `MCP_GATEWAY_CONCURRENCY` | `16` | Pooled gateway connections and concurrent gateway calls |

## Run, connect and demonstrate

```bash
python -m pip install -r services/mcp-server/requirements.txt

# Demo: real MCP client -> real server process over HTTP -> synthetic gateway; prints a trace.
python services/mcp-server/demo/demo.py

# Same client against a local RoboShop stack. Use a test customer's session; never pass it as an argument.
ROBOSHOP_DEMO_SESSION=... python services/mcp-server/demo/demo.py --gateway http://localhost:3000

# Local stdio server for a desktop client (the client injects MCP_SESSION_TOKEN).
MCP_TRANSPORT=stdio GATEWAY_URL=http://localhost:3000 python services/mcp-server/server.py   # or: npm run mcp

# Cluster: keep it private and port-forward.
kubectl --context=mk4 -n roboshop-ai port-forward service/mcp-server 4107:4107
```

The demo does the following:
1. Signs in a synthetic customer.
2. Lists the tools that customer may discover (no admin tools).
3. Searches for "inspection robot" and compares two SKUs.
4. Shows `admin_list_users` being refused before any gateway call.
5. Prints the connected trace that the server exported to the fixture.

The fixture (`demo/fixture_gateway.py`) uses only synthetic data, and the tests use the same
fixture.

To connect an HTTP client to the port-forward, configure
`http://localhost:4107/mcp` with an `Authorization: Bearer ${ROBOSHOP_SESSION}` header taken
from the client's secret or environment settings. Many clients expand `${VAR}` in config files.
Never put the token in a URL, a prompt, a command argument or source control.

## Tests

```bash
python -m unittest discover -s services/mcp-server/tests -v
```

- **Real client/server boundary:** every test drives a real FastMCP client, either in-memory,
  over Streamable HTTP via ASGI, or as a stdio subprocess.
- **Synthetic downstream:** the gateway is the synthetic fixture behind `httpx2.MockTransport`,
  with injected connection failures, slow responses, 429/5xx errors, garbage and oversized
  bodies.
- **Coverage:**
  - discovery and schemas
  - catalogue evidence and provenance
  - role filtering and gateway enforcement
  - session revocation
  - cross-user cart isolation and dropping of forwarded headers
  - write conflicts and duplicates
  - confirmation binding and replay
  - retries, deadlines and cancellation without replay
  - admission limits
  - redaction
  - Host/Origin and body limits
  - readiness
  - connected and unsampled traces
  - telemetry failure
- **Docker:** the Docker build runs these tests.

## Troubleshooting

| Symptom | Check |
|---|---|
| HTTP 401 on `/mcp` | Bearer missing, not 64-hex, expired or revoked; or the gateway `/api/auth/me` is unreachable (log `mcp_authentication_failed`) |
| HTTP 421 / 403 | `Host` not in `MCP_ALLOWED_HOSTS`, or an `Origin` header not in `MCP_ALLOWED_ORIGINS` |
| "Unknown tool" | The role cannot see that tool, or an admin write tool is not enabled |
| `rate_limited` with outcome `admission_rejected` | Per-user limit; wait a minute or raise `MCP_CALLS_PER_MINUTE` |
| `/ready` returns 503 | `GATEWAY_URL` unreachable, or the gateway's own `/health/ready` is failing |
| "Connection closed" over stdio | The client closed stdin before answers arrived. Keep stdin open until the replies are read. |
| No spans | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` unset, `OTEL_SDK_DISABLED=true`, or the caller sent an unsampled `traceparent` |

## Deployment

- **Argo CD** (`argocd/mcp-server.yaml`) syncs three manifests:
  - `mcp-server-deployment-minikube.yaml`: non-root UID 1000, read-only root filesystem, all
    capabilities dropped, RuntimeDefault seccomp, no service-account token.
  - `mcp-server-service-minikube.yaml`: ClusterIP only.
  - `mcp-server-network-policy-minikube.yaml`: only pods labelled `roboshop.ai/mcp-client: "true"`
    may connect.
- **No in-cluster clients today:** no current workload carries the `roboshop.ai/mcp-client`
  label, so in-cluster access is closed until you add it. Port-forwarding is unaffected.
- **Build and deploy:**

  ```bash
  # Images are built and pushed to ECR by each service's CI workflow (`.github/workflows/ci-<service>.yml`, which calls `publish-ecr.yml`) on pushes to `master`.
  bash scripts/deploy/deploy-minikube.sh mcp-server
  ```

## Known limitations

- Over HTTP, every MCP user reaches the gateway from the pod address and so shares its
  per-address limit of 300 requests per minute. The per-user admission limit here keeps one
  user from exhausting it, but the gateway cannot tell MCP users apart by address.
- The cart API has no client-visible revision, so `update_cart` relies on set semantics and
  the gateway's internal cart version rather than optimistic concurrency.
- Discovery filtering uses the role at the start of each HTTP request. A role change takes
  effect on the next request, and the gateway rechecks every call regardless.
- Confirmation nonces are kept in memory. They are single-use only within one replica, and
  are lost on restart (they also expire after two minutes).
