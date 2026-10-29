"""FastMCP entry point: stdio locally, authenticated Streamable HTTP in Kubernetes."""
import os
import re
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import anyio
import jsonschema
from fastmcp import FastMCP
from fastmcp.tools import Tool, ToolResult
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token, get_context
from mcp_types import TextContent
from opentelemetry import trace
from pydantic import PrivateAttr
from starlette.responses import JSONResponse
from confirmation import Confirmations, ConfirmationError
from gateway_client import GatewayClient, GatewayError
from gateway_tools import TOOLS, validate
from runtime import ctx, log_event

ROLES = ("customer", "admin", "superadmin")
TOOL_DEADLINE = float(os.getenv("MCP_TOOL_DEADLINE_SECONDS", "10"))
MESSAGES = {
    "invalid_argument": "The arguments do not match this tool's input schema.",
    "unauthenticated": "Sign in to RoboShop again; the session is missing, expired or revoked.",
    "forbidden": "This account does not have permission for this operation.",
    "not_found": "The requested record was not found.",
    "conflict": "The request conflicts with the record's current state. Refresh it and ask the user before trying again.",
    "rate_limited": "Too many requests. Wait a minute before trying again.",
    "dependency_unavailable": "A RoboShop service is unavailable. Try again shortly.",
    "invalid_response": "A RoboShop service returned an unexpected response.",
    "timeout": "RoboShop did not respond in time. Check before repeating any change.",
    "confirmation_required": "This change needs a fresh confirmation from the user.",
    "confirmation_declined": "The user did not confirm this change. Nothing was changed.",
    "confirmation_unavailable": "This client cannot ask the user to confirm changes. Use the RoboShop admin console.",
}
RETRYABLE = {"rate_limited", "dependency_unavailable", "timeout"}
DEFAULT_HOSTS = "mcp-server,mcp-server.roboshop-ai,mcp-server.roboshop-ai.svc,mcp-server.roboshop-ai.svc.cluster.local"


class ShopSessionVerifier(TokenVerifier):
    """Internal opaque-session adapter, not an OAuth authorization server."""
    def __init__(self, gateway):
        super().__init__()
        self.gateway = gateway

    async def verify_token(self, token):
        if not re.fullmatch(r"[a-f0-9]{64}", token or ""):
            return None
        try:
            # No cache: expired and revoked sessions fail on the next request.
            result = await self.gateway.request("GET", "/api/auth/me", session=token,
                                                deadline=anyio.current_time() + 3, retry=True)
        except GatewayError as error:
            log_event("mcp_authentication_failed", "WARN", errorCode=error.code)
            return None
        user = result.get("user")
        if not isinstance(user, dict) or not isinstance(user.get("id"), str) or user.get("role") not in ROLES:
            return None
        return AccessToken(token=token, client_id="roboshop-session", scopes=[], subject=user["id"],
                           claims={"role": user["role"]})


class Admission:
    """Per-identity rate and global in-flight limits; every MCP user shares one gateway client address."""
    def __init__(self, per_minute=None, in_flight=None):
        self.per_minute = per_minute or int(os.getenv("MCP_CALLS_PER_MINUTE", "60"))
        self.max_in_flight = in_flight or int(os.getenv("MCP_MAX_IN_FLIGHT", "32"))
        self.windows, self.in_flight = {}, 0

    def enter(self, subject):
        now = time.monotonic()
        if len(self.windows) > 10000:
            self.windows = {k: v for k, v in self.windows.items() if now - v[0] < 60}
        start, count = self.windows.get(subject, (now, 0))
        if now - start >= 60:
            start, count = now, 0
        if count >= self.per_minute or self.in_flight >= self.max_in_flight:
            return False
        self.windows[subject] = (start, count + 1)
        self.in_flight += 1
        return True

    def leave(self):
        self.in_flight -= 1


def role_check(roles):
    def check(context):
        token = context.token
        return token is not None and (roles is None or (token.claims or {}).get("role") in roles)
    return check


class GatewayTool(Tool):
    _spec = PrivateAttr()
    _app = PrivateAttr()

    def __init__(self, spec, app):
        super().__init__(name=spec.name, title=spec.title, description=spec.description,
                         parameters=spec.input_schema, output_schema=spec.output_schema,
                         annotations=spec.annotations, auth=role_check(spec.roles) if app.http else None)
        self._spec, self._app = spec, app

    def _identity(self):
        if self._app.http:
            access = get_access_token()
            return (access.token, access.subject) if access else ("", "")
        return os.getenv("MCP_SESSION_TOKEN", ""), "stdio"

    async def run(self, arguments):
        spec, app = self._spec, self._app
        span = trace.get_current_span()
        started, outcome = time.monotonic(), "success"
        # Link outgoing gateway spans to FastMCP's tool span, keeping its sampling decision.
        sc, token = span.get_span_context(), None
        if sc.is_valid:
            token = ctx.set({"traceId": format(sc.trace_id, "032x"), "spanId": format(sc.span_id, "016x"),
                             "flags": format(int(sc.trace_flags), "02x"), "tracestate": sc.trace_state.to_header(),
                             "service": "mcp-server", "attributes": {}})
        try:
            try:
                validate(arguments, self.parameters)
            except ValueError:
                raise GatewayError("invalid_argument", 400) from None
            session, subject = self._identity()
            if spec.roles and not re.fullmatch(r"[a-f0-9]{64}", session):
                raise GatewayError("unauthenticated", 401)
            if not app.admission.enter(subject or "anonymous"):
                outcome = "admission_rejected"
                raise GatewayError("rate_limited", 429)
            try:
                if spec.confirm:
                    try:
                        ask = await app.confirmations.check(get_context(), subject, spec.name, arguments, spec.confirm(arguments))
                    except ConfirmationError as error:
                        raise GatewayError(error.code, 428) from None
                    if ask is not None:
                        outcome = "confirmation_requested"
                        return ask
                method, path, params, body = spec.request(arguments)
                deadline = anyio.current_time() + TOOL_DEADLINE
                call = app.gateway.request(method, path, params=params, body=body, session=session,
                                           deadline=deadline, retry=not spec.write, accept=spec.accept)
                if spec.write:
                    # A started change runs to its own deadline even if the client cancels; never replayed.
                    with anyio.CancelScope(shield=True):
                        data = await call
                else:
                    data = await call
                try:
                    result = spec.shape(data, arguments)
                    app.validators[spec.name].validate(result)
                except (KeyError, TypeError, ValueError, AttributeError, jsonschema.ValidationError):
                    raise GatewayError("invalid_response", 502) from None
                return ToolResult(structured_content=result)
            finally:
                app.admission.leave()
        except GatewayError as error:
            outcome = error.code if outcome == "success" else outcome
            return self._error(error, sc)
        finally:
            span.set_attribute("mcp.tool.outcome", outcome)
            if outcome not in ("success", "confirmation_requested"):
                span.set_attribute("error.type", outcome)
                span.set_status(trace.StatusCode.ERROR)
            log_event("mcp_tool_completed", "INFO" if outcome in ("success", "confirmation_requested") else "WARN",
                      operation=spec.name, outcome=outcome, durationMs=round((time.monotonic() - started) * 1000))
            if token is not None:
                ctx.reset(token)

    def _error(self, error, sc):
        code = error.code
        correlation = format(sc.trace_id, "032x") if sc.is_valid else (ctx.get() or {}).get("traceId") or error.request_id
        message = MESSAGES.get(code, MESSAGES["dependency_unavailable"])
        body = {"code": code, "message": message, "retryable": code in RETRYABLE and not self._spec.write}
        if error.detail:
            body["detail"] = error.detail
        if correlation:
            body["correlationId"] = correlation
        text = message + (" " + error.detail if error.detail else "") + (f" (correlation ID {correlation})" if correlation else "")
        return ToolResult(content=[TextContent(type="text", text=text)], structured_content={"error": body}, is_error=True)


class App:
    def __init__(self, http, gateway, admin_writes):
        self.http, self.gateway, self.admin_writes = http, gateway, admin_writes
        self.admission = Admission()
        self.confirmations = Confirmations()
        self.validators = {s.name: jsonschema.Draft202012Validator(s.output_schema) for s in TOOLS}


def create_server(*, http=False, gateway=None, admin_writes=None):
    gateway = gateway or GatewayClient()
    if admin_writes is None:
        admin_writes = os.getenv("MCP_ENABLE_ADMIN_WRITES") == "true"
    app = App(http, gateway, admin_writes)

    @asynccontextmanager
    async def lifespan(server):
        try:
            yield {}
        finally:
            await gateway.aclose()

    server = FastMCP("RoboShop MCP", version="1.1.0", mask_error_details=True, strict_input_validation=True,
                     lifespan=lifespan, auth=ShopSessionVerifier(gateway) if http else None)
    # Consequential admin writes are off unless explicitly enabled, and then need confirmation.
    for spec in TOOLS:
        if not spec.confirm or admin_writes:
            server.add_tool(GatewayTool(spec, app))

    @server.custom_route("/health", methods=["GET"])
    async def health(request):
        return JSONResponse({"status": "ok"})

    ready_cache = {"at": -1e9, "ok": False}

    @server.custom_route("/ready", methods=["GET"])
    async def ready(request):
        now = anyio.current_time()
        if now - ready_cache["at"] > 5:
            try:
                await gateway.request("GET", "/health/ready", deadline=now + 2)
                ready_cache["ok"] = True
            except GatewayError:
                ready_cache["ok"] = False
            ready_cache["at"] = anyio.current_time()
        if ready_cache["ok"]:
            return JSONResponse({"status": "ready"})
        return JSONResponse({"status": "unavailable", "dependency": "gateway"}, status_code=503)
    return server


def http_options():
    """Strict Host/Origin checks (DNS-rebinding defence) and stateless sessions."""
    hosts = [h.strip() for h in os.getenv("MCP_ALLOWED_HOSTS", DEFAULT_HOSTS).split(",") if h.strip()]
    origins = [o.strip() for o in os.getenv("MCP_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    return {"path": "/mcp", "stateless_http": True, "json_response": True, "host_origin_protection": True,
            "allowed_hosts": hosts, "allowed_origins": origins}


def create_http_app(server):
    """Shared by Kubernetes and tests. Tracing is outermost so session checks join the request trace."""
    from otel_bridge import HTTPTracing
    return HTTPTracing(server.http_app(**http_options()))


def main():
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    if transport not in ("stdio", "http"):
        raise SystemExit("MCP_TRANSPORT must be stdio or http")
    from runtime import configure_telemetry
    from otel_bridge import configure
    configure_telemetry("mcp-server")
    configure()
    server = create_server(http=transport == "http")
    if transport == "http":
        import uvicorn
        uvicorn.run(create_http_app(server), host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "4107")),
                    access_log=False, limit_concurrency=64, timeout_keep_alive=5, timeout_graceful_shutdown=2)
    else:
        server.run(transport="stdio", show_banner=False)


if __name__ == "__main__":
    main()
