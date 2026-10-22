"""FastMCP entry point: stdio locally, authenticated Streamable HTTP in Kubernetes."""
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from fastmcp import FastMCP
from fastmcp.tools import Tool, ToolResult
from fastmcp.exceptions import ToolError
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token
from pydantic import PrivateAttr
from anyio import to_thread
from starlette.responses import JSONResponse
from gateway_tools import GatewayTools, TOOLS, validate
from opentelemetry import trace
from runtime import ctx, upstream, HttpError, trace_span, configure_telemetry, log_event


class ShopSessionVerifier(TokenVerifier):
    """Internal opaque-session adapter, not an OAuth authorization server."""
    def __init__(self, fetcher=upstream):
        super().__init__()
        self.fetcher = fetcher

    async def verify_token(self, token):
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            return None
        try:
            result = await to_thread.run_sync(lambda: self.fetcher(
                os.getenv("GATEWAY_URL", "http://127.0.0.1:3000").rstrip("/") + "/api/auth/me",
                headers={"cookie": "rs_auth=" + token}, timeout=3))
            user = result.get("user")
            if not isinstance(user, dict) or not user.get("id"):
                return None
            return AccessToken(token=token, client_id=str(user["id"]), scopes=[], subject=str(user["id"]))
        except Exception as error:
            log_event("mcp_authentication_failed", "WARN", errorType=type(error).__name__)
            return None  # Fail closed; no cache of expired/revoked sessions.


class GatewayTool(Tool):
    _gateway: GatewayTools = PrivateAttr()
    _http: bool = PrivateAttr()

    def __init__(self, spec, gateway, http):
        super().__init__(name=spec["name"], description=spec["description"],
                         parameters=spec["inputSchema"], annotations=spec["annotations"])
        self._gateway, self._http = gateway, http

    async def run(self, arguments):
        # Keep the original strict schemas, including no coercion, no extra fields,
        # finite prices, SKU patterns, and optimistic revision fields.
        try:
            validate(arguments, self.parameters)
        except ValueError:
            raise ToolError("Invalid tool arguments.") from None
        if self._http:
            access = get_access_token()
            session = access.token if access else ""
            if not session:
                raise ToolError("An authenticated RoboShop session is required.")
        else:
            session = os.getenv("MCP_SESSION_TOKEN", "")
        def call():
            # FastMCP owns the tool observation. Link outgoing calls to that native span.
            sc = trace.get_current_span().get_span_context()
            token = None
            if sc.is_valid:
                token = ctx.set({'traceId':format(sc.trace_id,'032x'),'spanId':format(sc.span_id,'016x'),
                                 'flags':format(int(sc.trace_flags),'02x'),'tracestate':sc.trace_state.to_header(),
                                 'service':'mcp-server','attributes':{}})
            try: return self._gateway.call(self.name, arguments, session=session)
            finally:
                if token is not None: ctx.reset(token)
        try:
            result = await to_thread.run_sync(call)
            return ToolResult(content=result)
        except HttpError as error:
            log_event("mcp_tool_rejected", "WARN", operation=self.name, status=error.status)
            messages = {401: "Your session has expired. Sign in again.",
                        403: "Your account does not have permission for this operation.",
                        409: "The record changed. Refresh it before retrying.",
                        400: "The gateway rejected the supplied values."}
            raise ToolError(messages.get(error.status, "The requested service is unavailable.")) from None
        except Exception as error:
            log_event("mcp_tool_failed", "ERROR", operation=self.name, errorType=type(error).__name__)
            raise ToolError("The requested service is unavailable.") from None


def create_server(*, http=False, fetcher=upstream):
    server = FastMCP("RoboShop MCP", version="1.0.0", mask_error_details=True,
                     strict_input_validation=True,
                     auth=ShopSessionVerifier(fetcher) if http else None)
    gateway = GatewayTools(fetcher)
    for spec in TOOLS:
        server.add_tool(GatewayTool(spec, gateway, http))

    @server.custom_route("/health", methods=["GET"])
    async def health(request):
        return JSONResponse({"status": "ok"})

    @server.custom_route("/ready", methods=["GET"])
    async def ready(request):
        try:
            await to_thread.run_sync(lambda: fetcher(
                os.getenv("GATEWAY_URL", "http://127.0.0.1:3000").rstrip("/") + "/health/ready", timeout=2))
            return JSONResponse({"status": "ready"})
        except Exception:
            return JSONResponse({"status": "unavailable", "dependency": "gateway"}, status_code=503)
    return server


def main():
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    if transport not in ("stdio", "http"):
        raise SystemExit("MCP_TRANSPORT must be stdio or http")
    configure_telemetry("mcp-server")
    from otel_bridge import configure, HTTPTracing
    from starlette.middleware import Middleware
    configure()
    server = create_server(http=transport == "http")
    if transport == "http":
        server.run(transport="http", host=os.getenv("HOST", "0.0.0.0"),
                   port=int(os.getenv("PORT", "4107")), path="/mcp",
                   stateless_http=True, json_response=True, show_banner=False, middleware=[Middleware(HTTPTracing)])
    else:
        server.run(transport="stdio", show_banner=False)


if __name__ == "__main__":
    main()
