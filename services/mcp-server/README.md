# RoboShop FastMCP service

FastMCP owns protocol negotiation, tool discovery, dispatch and transport. The
service preserves 15 tools, their strict schemas and mutation annotations. Tool
implementations live in `gateway_tools.py`; all calls go through the gateway,
which checks account ownership, roles and optimistic product revisions. Tools do
not execute shell commands, accept arbitrary upstream URLs or take payments.

## Kubernetes: Streamable HTTP

The container runs `MCP_TRANSPORT=http` on port **4107**, endpoint **`/mcp`**:
`http://mcp-server.roboshop-ai.svc.cluster.local:4107/mcp`.
This is an internal ClusterIP service, with no public ingress. Use a trusted cluster
network or a local authenticated port-forward; do not expose bearer sessions over
public plaintext HTTP. Public deployment would require TLS and an appropriate
MCP OAuth authorization flow.

Each HTTP client must supply `Authorization: Bearer <its-own-rs_auth-session>`.
The custom FastMCP verifier checks that session against `/api/auth/me` on every
request, without caching it. The gateway also validates the same session and role
on each protected tool call. Expired/revoked sessions fail closed. This is an
internal opaque-session integration, **not an OAuth server**. Never put tokens in
URLs, prompts, source code or command arguments.

HTTP mode deliberately ignores `MCP_SESSION_TOKEN`: there is no shared user
identity in the Deployment. Authentication applies to discovery and read tools
too. Stateless HTTP avoids cross-client session state. A customer cannot gain
admin permissions by choosing an admin tool.

- `/health`: process liveness, no dependency requests.
- `/ready`: bounded gateway readiness check; failures return 503.
- Neither health endpoint requires a user session.
- Gateway network calls run in worker threads; no automatic mutation retries.
- Tool failures are sanitized; traces retain `mcp.tool <name>` spans.

For local access:

```bash
kubectl --context=mk4 -n roboshop-ai port-forward service/mcp-server 4107:4107
```

Then configure your MCP client with `http://localhost:4107/mcp` and inject its
session bearer token through the client's secret settings.

## Local stdio

```bash
python -m pip install -r services/mcp-server/requirements.txt
MCP_TRANSPORT=stdio python services/mcp-server/server.py
# Or: npm run mcp
```

Stdio is the default when running Python directly. Public read tools need no
session; protected tools use `MCP_SESSION_TOKEN`, injected by the local client.
Set `GATEWAY_URL` and `PUBLIC_ORIGIN` to your store's internal URL and exact public
origin. Logs go to stderr, preserving stdout for protocol messages only.

## Tests, build and deployment

```bash
python -m unittest discover -s services/mcp-server/tests -v
bash build-push-ecr.sh mcp-server
bash deploy-minikube.sh mcp-server
```

Tests use the actual FastMCP client, stdio subprocess and HTTP transport with
mocked gateway calls. They cover schemas, invalid input, auth isolation, revocation,
role rejection, safe errors and health checks. Docker runs these tests before
publishing; dependencies are pinned in this service's `requirements.txt`.
The Docker build context remains `services/mcp-server`.

Existing stdio clients keep the same tool names and arguments. HTTP clients must
provide their own sessions; existing `MCP_SESSION_TOKEN` Secret values can remain
for old clients but are no longer injected into Kubernetes pods.
