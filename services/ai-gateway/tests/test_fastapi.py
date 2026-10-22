"""Real ASGI HTTP requests with isolated domain services and mocked downstream I/O."""
import os
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import threading
from concurrent.futures import ThreadPoolExecutor
import mongomock
from fastapi.testclient import TestClient
sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'lib')]
from asgi_app import create_app
from server import Gateway
from store import Store
from runtime import HttpError

class FastAPIContract(unittest.TestCase):
    def setUp(self):
        env=patch.dict(os.environ,USER_SERVICE_TOKEN='u'*64,LLM_SERVICE_TOKEN='l'*64,PUBLIC_ORIGIN='https://shop.example')
        env.start();self.addCleanup(env.stop)
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        self.store=Store(folder.name);self.addCleanup(self.store.close)
        self.gateway=Gateway(mongomock.MongoClient().db,self.store)
        self.gateway.auth.current=Mock(return_value=None)
        self.client=TestClient(create_app(self.gateway));self.client.__enter__();self.addCleanup(lambda:self.client.__exit__(None,None,None))
    def test_safe_login_error_is_not_masked(self):
        with patch.object(self.gateway, 'handle', side_effect=HttpError(401, 'Invalid email or password.')):
            response = self.client.post('/api/auth/login', json={'email':'user@example.com','password':'private'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error'], 'Invalid email or password.')
        self.assertEqual(response.json()['code'], 'AUTH_INVALID_CREDENTIALS')
        self.assertIn('requestId', response.json())

    def test_default_none_auth_and_redaction(self):
        denied=self.client.post('/api/chat',json={'message':'private prompt'})
        self.assertEqual(denied.status_code,403)
        self.assertEqual(self.client.post('/api/chat',json={'message':'private prompt'},headers={'Authorization':'Bearer '+'l'*64}).status_code,401)
        self.gateway.auth.current.return_value={'id':'a','role':'customer'}
        response=self.client.post('/api/chat',json={'message':'private prompt'},headers={'Authorization':'Bearer '+'l'*64})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['code'],'LLM_NOT_CONFIGURED')
        self.assertEqual(response.json()['answer'],'Please connect an LLM to get results.')
        self.assertNotIn('private prompt',response.text)
        self.assertIn('x-request-id',response.headers)
        self.assertEqual(response.headers['x-content-type-options'],'nosniff')
        self.gateway.auth.current.return_value=None
        self.assertEqual(self.client.get('/api/admin/llm/status').status_code,401)
        self.gateway.auth.current.return_value={'id':'a','role':'customer'}
        self.assertEqual(self.client.get('/api/admin/llm/status').status_code,403)
        self.gateway.auth.current.return_value={'id':'a','role':'superadmin'}
        status=self.client.get('/api/admin/llm/status')
        self.assertEqual(status.status_code,200)
        self.assertNotIn('endpoints',status.json())
    def test_required_readiness_failure_optional_ai_independence_and_recovery(self):
        with patch('readiness.request',return_value={}),patch.object(self.gateway.db,'command',return_value={'ok':1}):
            self.assertEqual(self.client.get('/health/ready').status_code,200)
            with patch('readiness.request',side_effect=HttpError(503,'internal-secret')):
                response=self.client.get('/health/ready')
                self.assertEqual(response.status_code,503);self.assertNotIn('internal-secret',response.text)
                self.assertEqual(self.client.get('/health/live').status_code,200)
            self.assertEqual(self.client.get('/health/ready').status_code,200)
    def test_slow_blocking_work_does_not_block_liveness_or_duplicate(self):
        started,release=threading.Event(),threading.Event()
        def slow(req):
            started.set();release.wait(3);return {'saved':True}
        self.gateway.handle=Mock(side_effect=slow)
        with ThreadPoolExecutor() as pool:
            request=pool.submit(self.client.post,'/api/payments/orders',json={})
            try:
                self.assertTrue(started.wait(1))
                self.assertEqual(self.client.get('/health/live').status_code,200)
                self.assertEqual(self.gateway.handle.call_count,1)
            finally:release.set()
            self.assertEqual(request.result().status_code,200)
    def test_body_limits_cors_and_webhook_raw_bytes(self):
        self.assertEqual(self.client.post('/api/chat',content=b'x'*65537).status_code,413)
        preflight=self.client.options('/api/cart',headers={'origin':'https://evil.example','access-control-request-method':'POST'})
        self.assertNotIn('access-control-allow-origin',preflight.headers)
        self.assertEqual(self.client.options('/api/cart',headers={'origin':'https://shop.example','access-control-request-method':'POST'}).headers['access-control-allow-origin'],'https://shop.example')
        self.gateway.handle=lambda req: {'raw':req.raw().decode()}
        self.assertEqual(self.client.post('/api/payments/webhook',content='{"raw":  1}').json()['raw'],'{"raw":  1}')

    def test_cancelled_buffered_generation_is_not_replayed_or_switched(self):
        import anyio
        import httpx
        entered,release,completed=threading.Event(),threading.Event(),threading.Event()
        calls=[]
        def generate(req):
            calls.append('primary')
            entered.set()
            release.wait(3)
            completed.set()
            return {'answer':'one buffered answer','products':[]}
        self.gateway.handle=generate
        async def run():
            transport=httpx.ASGITransport(app=create_app(self.gateway))
            async with httpx.AsyncClient(transport=transport,base_url='http://local') as client:
                async with anyio.create_task_group() as group:
                    async def request():
                        await client.post('/api/chat',json={'message':'hello'})
                    group.start_soon(request)
                    await anyio.to_thread.run_sync(lambda: entered.wait(1))
                    group.cancel_scope.cancel()
                    release.set()
            self.assertTrue(completed.is_set())
        anyio.run(run)
        self.assertEqual(calls,['primary'])

    def test_ai_unavailable_preserves_503_and_safe_errors(self):
        self.gateway.handle=lambda req: Gateway.feature_unavailable(self.gateway,'finder')
        response=self.client.post('/api/chat',json={'message':'hello'})
        self.assertEqual(response.status_code,503)
        self.assertEqual(response.json()['code'],'feature-unavailable')

    def test_provider_diagnostics_are_cached_revision_scoped_and_redacted(self):
        self.gateway.auth.current.return_value={'id':'a','role':'superadmin'}
        self.gateway.llm.current=Mock(return_value={'config':{'provider':'ollama','model':'model'},'revision':3})
        with patch('llm.request',return_value={'revision':3,'providers':{'ollama':{'ready':True,'checkedAt':123,'scope':'model-listed','endpoint':'http://private','secret':'never-return'}}}) as call:
            response=self.client.get('/api/admin/llm/status')
            self.assertTrue(response.json()['providers']['ollama']['ready'])
            self.assertNotIn('private',response.text);self.assertNotIn('never-return',response.text)
            self.assertEqual(call.call_args.kwargs['timeout'],1)
        with patch('llm.request',side_effect=HttpError(503,'secret')):
            self.assertEqual(self.client.get('/api/admin/llm/status').json()['providers'],{})
