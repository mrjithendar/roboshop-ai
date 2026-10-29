"""Test wiring: the real FastMCP server and client, with the synthetic gateway behind httpx2.MockTransport."""
import sys
from contextlib import asynccontextmanager
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SERVICE), str(SERVICE / "lib"), str(SERVICE / "demo")]
import httpx2
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from fixture_gateway import FixtureGateway, ORIGIN, token
from gateway_client import GatewayClient
from server import create_server, create_http_app


def gateway_for(fixture):
    return GatewayClient("http://ai-gateway:3000", transport=fixture.transport(), origin=ORIGIN)


@asynccontextmanager
async def http_app(fixture, **kwargs):
    app = create_http_app(create_server(http=True, gateway=gateway_for(fixture), **kwargs))
    async with app.router.lifespan_context(app):
        yield app


def http_client(app, bearer=None, headers=None, base="http://localhost"):
    def factory(**kwargs):
        return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), **kwargs)
    headers = dict(headers or {})
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    return Client(StreamableHttpTransport(base + "/mcp", headers=headers, httpx_client_factory=factory))


def raw_client(app, base="http://localhost"):
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url=base)


__all__ = ["FixtureGateway", "ORIGIN", "token", "gateway_for", "http_app", "http_client", "raw_client", "create_server", "SERVICE"]
