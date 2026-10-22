import io
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import mongomock

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'services/ai-gateway'), str(ROOT/'services/ai-gateway/lib')]
from server import Gateway
from store import Store
from runtime import Request, HttpError, application
from readiness import probe

class ReadinessTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {'USER_SERVICE_TOKEN': 'u'*64, 'LLM_SERVICE_TOKEN': 'l'*64})
        env.start(); self.addCleanup(env.stop)
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.store = Store(self.tmp.name); self.addCleanup(self.store.close)
        self.gateway = Gateway(mongomock.MongoClient().db, self.store)
        self.gateway.db.command = Mock(return_value={'ok': 1})
        self.gateway.auth.current = Mock(return_value=None)
        self.gateway.catalogue = lambda **kwargs: [dict(sku='ROBOT', name='Robot', price=199, instock=5, currency='INR')]
        self.remote = patch('readiness.request', return_value={'status':'ready'})
        self.probes = self.remote.start(); self.addCleanup(self.remote.stop)
    def req(self, path, method='GET', data=b'{}'):
        return Request({'PATH_INFO':path,'REQUEST_METHOD':method,'CONTENT_LENGTH':str(len(data)),
                        'CONTENT_TYPE':'application/json','wsgi.input':io.BytesIO(data),
                        'HTTP_AUTHORIZATION':'Bearer '+'l'*64})
    def test_optional_failures_do_not_gate_core_routes_or_readiness(self):
        with patch('server.request', side_effect=HttpError(503, 'Optional service unavailable')):
            ready = self.gateway.handle(self.req('/api/ready'))
            self.assertEqual(ready[1], 200)
            self.gateway.auth.current.assert_not_called()
            self.assertEqual(len(self.gateway.handle(self.req('/api/products'))['products']), 1)
            cart = self.gateway.handle(self.req('/api/cart', 'POST', b'{"sku":"ROBOT","quantity":1}'))
            self.assertEqual(cart['subtotal'], 199)
            self.assertEqual(self.gateway.handle(self.req('/api/recommendations'))[0]['feature'], 'recommendations')
            self.gateway.llm.current = lambda: {'config': {'provider':'bedrock'}, 'revision':1}
            self.assertEqual(self.gateway.handle(self.req('/api/chat', 'POST', b'{"message":"Help"}'))[0]['code'], 'feature-unavailable')
            self.assertEqual(self.gateway.handle(self.req('/api/ops'))[1], 503)
        urls = [call.args[0] for call in self.probes.call_args_list]
        self.assertTrue(all(url.endswith(('/api/catalogue/ready','/api/users/ready')) for url in urls))
    def test_required_failure_recovery_and_liveness(self):
        self.store.cart_repository = SimpleNamespace(url='http://cart:4107')
        for missing in ('mongodb', 'catalogue', 'users', 'cart'):
            with self.subTest(missing=missing):
                self.gateway.db.command.side_effect = RuntimeError('db down') if missing == 'mongodb' else None
                def check(url, **kwargs):
                    self.assertEqual(kwargs['timeout'], 1)
                    if (missing == 'catalogue' and '/api/catalogue/ready' in url or
                        missing == 'users' and '/api/users/ready' in url or missing == 'cart' and url.startswith('http://cart')):
                        raise HttpError(503, 'down')
                self.probes.side_effect = check
                result = self.gateway.handle(self.req('/api/ready'))
                self.assertEqual(result[1], 503)
                self.assertEqual(result[0]['dependencies'][missing], 'unavailable')
                status = []
                application('ai-gateway', self.gateway.handle)({'PATH_INFO':'/health','REQUEST_METHOD':'GET','wsgi.input':io.BytesIO()}, lambda code, _:status.append(code))
                self.assertTrue(status[0].startswith('200'))
                self.probes.side_effect = None; self.gateway.db.command.side_effect = None
                self.assertEqual(self.gateway.handle(self.req('/api/ready'))[1], 200)
    def test_probe_budget_and_closed_writer(self):
        release = threading.Event()
        start = time.monotonic()
        try:
            result = probe({'stuck': lambda: release.wait(2)}, budget=.05)
            self.assertEqual(result[1], 503)
            self.assertLess(time.monotonic()-start, .5)
        finally: release.set()
        self.store.close()
        self.assertEqual(self.gateway.handle(self.req('/api/ready'))[0]['dependencies']['ledger'], 'unavailable')

    def test_agent_readiness_uses_catalogue_not_model_calls(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('readiness_agent', ROOT/'services/moks/server.py')
        agent = importlib.util.module_from_spec(spec)
        with patch.object(sys, 'path', [str(ROOT/'services/moks'), *sys.path]):
            spec.loader.exec_module(agent)
        with patch.object(agent, 'route', side_effect=AssertionError('No model probes')), patch.object(agent, 'request') as check:
            self.assertEqual(agent.handle(self.req('/ready')), {'status':'ready'})
            self.assertTrue(check.call_args.args[0].endswith('/api/catalogue/ready'))
            self.assertEqual(check.call_args.kwargs['timeout'], 1)
            check.side_effect = HttpError(503, 'catalogue unavailable')
            self.assertEqual(agent.handle(self.req('/ready'))[1], 503)
            check.side_effect = None
            self.assertEqual(agent.handle(self.req('/ready')), {'status':'ready'})

    def test_manifests_use_local_liveness_and_scoped_readiness(self):
        import yaml
        paths = {'ai-gateway':'/health/ready', 'nginx':'/ready',
                 'moks':'/ready', 'catalogue-service':'/api/catalogue/ready', 'sre-copilot':'/ready'}
        for name, path in paths.items():
            with self.subTest(service=name):
                manifests = yaml.safe_load_all((ROOT / f'services/{name}/{name}-minikube.yaml').read_text())
                deployment = next(doc for doc in manifests if doc['kind'] == 'Deployment')
                container = deployment['spec']['template']['spec']['containers'][0]
                self.assertEqual(container['livenessProbe']['httpGet']['path'], '/health/live' if name == 'ai-gateway' else '/health')
                self.assertEqual(container['startupProbe']['httpGet']['path'], '/health/live' if name == 'ai-gateway' else '/health')
                self.assertEqual(container['readinessProbe']['httpGet']['path'], path)
                self.assertLessEqual(container['readinessProbe']['timeoutSeconds'], 5)

if __name__ == '__main__': unittest.main()
