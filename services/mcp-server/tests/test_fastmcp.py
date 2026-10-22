"""Exercise real FastMCP protocol transports with mocked gateway calls only."""
import asyncio
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SERVICE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SERVICE), str(SERVICE/'lib')]
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
import httpx2
from server import create_server, TOOLS, ShopSessionVerifier
from runtime import HttpError, log_event

class FastMCPTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.calls = []
        self.revoked = set()
        def fake(url, data=None, headers=None, **kwargs):
            self.calls.append((url, data, headers, kwargs))
            if url.endswith('/api/auth/me'):
                token = headers['cookie'].split('=',1)[1]
                return {'user': None if token in self.revoked else {'id': token[:4]}}
            if url.endswith('/api/admin/users?'):
                raise HttpError(403, 'sensitive internal details')
            return {'ok': True, 'owner': (headers or {}).get('cookie')}
        self.fetcher = fake
        self.server = create_server(fetcher=fake)

    async def test_all_schemas_and_annotations_preserved(self):
        async with Client(self.server) as c:
            tools = await c.list_tools()
            self.assertEqual(len(tools), 15)
            for t in tools:
                expected = next(s for s in TOOLS if s['name'] == t.name)
                self.assertEqual(t.input_schema, expected['inputSchema'])
                self.assertEqual(t.annotations.destructive_hint, expected['annotations']['destructiveHint'])

    async def test_public_reads_and_strict_invalid_arguments(self):
        async with Client(self.server) as c:
            self.assertFalse((await c.call_tool('compare_products', {'skus':['RED','RMC']})).is_error)
            self.assertIn('skus=RED%2CRMC', self.calls[0][0])
            for name,args in [('compare_products',{'skus':['RED','RED']}),('search_products',{'query':'x','url':'http://evil'}),('update_cart',{'sku':'X','quantity':True}),('admin_update_settings',{'secret':'x'}),('admin_set_user_access',{'userId':'a'*36,'role':'superadmin','disabled':False}),('execute_shell',{})]:
                result = await c.call_tool(name,args,raise_on_error=False)
                self.assertTrue(result.is_error, name)
            self.assertEqual(len(self.calls),1)

    async def test_stdio_session_and_gateway_role_checks(self):
        async with Client(self.server) as c:
            with patch.dict(os.environ, {'MCP_SESSION_TOKEN':''}):
                self.assertTrue((await c.call_tool('view_cart',raise_on_error=False)).is_error)
            with patch.dict(os.environ, {'MCP_SESSION_TOKEN':'a'*64}):
                self.assertFalse((await c.call_tool('update_cart',{'sku':'X','quantity':0})).is_error)
                result = await c.call_tool('admin_list_users',raise_on_error=False)
                self.assertTrue(result.is_error)
                self.assertNotIn('sensitive',str(result.content))
            self.assertEqual(self.calls[0][2]['cookie'],'rs_auth='+'a'*64)
            self.assertEqual(self.calls[0][3]['method'],'POST')

    async def test_real_stdio_initialization_keeps_stdout_protocol_clean(self):
        from fastmcp.client.transports import PythonStdioTransport
        async with Client(PythonStdioTransport(str(SERVICE/'server.py'), python_cmd=sys.executable, env={'MCP_TRANSPORT':'stdio'})) as c:
            self.assertEqual(len(await c.list_tools()),15)
        with patch('sys.stdout',new_callable=io.StringIO) as out, patch('sys.stderr',new_callable=io.StringIO) as err:
            log_event('mcp_test')
            self.assertEqual(out.getvalue(),'')
            self.assertIn('mcp_test',err.getvalue())

    async def test_http_sessions_isolated_no_shared_environment_fallback(self):
        app=create_server(http=True,fetcher=self.fetcher).http_app(stateless_http=True,json_response=True)
        def factory(**kwargs):
            return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app),**kwargs)
        async with app.router.lifespan_context(app):
            async def get_cart(token):
                transport=StreamableHttpTransport('http://localhost/mcp',headers={'Authorization':'Bearer '+token},httpx_client_factory=factory)
                async with Client(transport) as c:
                    return await c.call_tool('view_cart')
            with patch.dict(os.environ, {'MCP_SESSION_TOKEN':'c'*64}):
                await asyncio.gather(get_cart('a'*64),get_cart('b'*64))
                cookies=[call[2]['cookie'] for call in self.calls if call[0].endswith('/api/cart')]
                self.assertCountEqual(cookies,['rs_auth='+'a'*64,'rs_auth='+'b'*64])
                async with factory() as http:
                    self.assertEqual((await http.post('http://localhost/mcp',json={})).status_code,401)
                    self.revoked.add('a'*64)
                    self.assertEqual((await http.post('http://localhost/mcp',json={},headers={'Authorization':'Bearer '+'a'*64})).status_code,401)
                    self.assertEqual((await http.get('http://localhost/health')).status_code,200)
                    self.assertEqual((await http.get('http://localhost/ready')).status_code,200)

    async def test_gateway_outage_readiness_and_auth_fail_closed(self):
        def failed(*args,**kwargs): raise HttpError(503,'internal secret')
        self.assertIsNone(await ShopSessionVerifier(failed).verify_token('a'*64))
        app=create_server(http=True,fetcher=failed).http_app(stateless_http=True)
        async with app.router.lifespan_context(app):
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app),base_url='http://localhost') as c:
                self.assertEqual((await c.get('/health')).status_code,200)
                self.assertEqual((await c.get('/ready')).status_code,503)
