"""Offline transport metadata and route-vocabulary regressions."""
import importlib.util
import io
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'services/ai-gateway/lib'))
import trace_routes

class Routes(unittest.TestCase):
    def test_admin_routes_and_prefixes(self):
        for method, path in [('GET','/api/admin/products'), ('GET','/api/admin/settings'), ('GET','/api/admin/llm/status'), ('POST','/api/admin/llm/test'), ('POST','/api/admin/llm/disconnect')]:
            for prefix in ('', '/roboshop'):
                self.assertEqual(trace_routes.http_name(method, prefix+path+'?private=secret'), method+' '+prefix+path)
        self.assertEqual(trace_routes.http_name('GET','/unknown/secret'), 'GET')
        self.assertTrue(trace_routes.quiet_route('/roboshop/health'))

    def test_handler_literal_coverage_and_local_copy_parity(self):
        # Scan all production handler modules, including delegated admin/LLM
        # dispatchers. New literal API routes must enter the bounded vocabulary.
        for p in (ROOT/'services').rglob('*'):
            if p.suffix not in ('.py','.mjs','.java','.go') or any(x in p.parts for x in ('tests','lib','node_modules','build','.gradle','frontend')):
                continue
            for route in re.findall(r'''["'](/(?:api|internal)/[A-Za-z0-9_./-]+)["']''', p.read_text()):
                if route.endswith('/') or route == '/api/tags': continue  # dispatch prefix / external Ollama API
                self.assertTrue(trace_routes.route_template(route), (str(p),route))
        expected=(ROOT/'services/ai-gateway/lib/trace_routes.py').read_text()
        for p in (ROOT/'services').glob('*/lib/trace_routes.py'):
            self.assertEqual(p.read_text(),expected,str(p))
        copies=list((ROOT/'services').glob('*/lib/trace-routes.mjs'))
        for p in copies:self.assertEqual(p.read_text(),copies[0].read_text(),str(p))

    def test_dynamic_routes_are_bounded(self):
        for path, template in [('/api/admin/products/SECRET','/api/admin/products/{product_id}'),('/api/products/SECRET/reviews/mine','/api/products/{product_id}/reviews/mine'),('/internal/carts/SECRET/clear-checked','/internal/carts/{cart_id}/clear-checked'),('/api/catalogue/search/SECRET','/api/catalogue/search/{query}'),('/api/admin/test-orders/SECRET/reconcile','/api/admin/test-orders/{order_id}/reconcile')]:
            self.assertEqual(trace_routes.route_template(path+'?q=secret'),template)

class Clients(unittest.TestCase):
    def test_service_local_clients(self):
        for p in (ROOT/'services').glob('*/lib/runtime.py'):
            spec=importlib.util.spec_from_file_location('review_runtime',p)
            runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
            for status in (429,400,503,200,None,'timeout'):
                with self.subTest(service=p.parts[-3],status=status):
                    spans=[]
                    if status == 200:
                        response=io.BytesIO(b'{"ok":true}');response.status=200
                        effect=None
                    else:
                        response=None
                        effect=TimeoutError() if status=='timeout' else URLError('offline') if status is None else HTTPError('http://local/api/products',status,'private',{},io.BytesIO(b'{}'))
                    with patch.object(runtime,'telemetry',side_effect=lambda service,ctx,start,name,status:spans.append((ctx,status))), patch.object(runtime.urllib.request,'urlopen',return_value=response,side_effect=effect) as transport, patch.object(runtime.time,'sleep'):
                        if status==200: self.assertEqual(runtime.request('http://local/api/products'),{'ok':True})
                        else:
                            with self.assertRaises(runtime.HttpError) as caught:runtime.request('http://local/api/products')
                            self.assertEqual(caught.exception.status,502 if isinstance(status,int) else 503)
                    attrs=spans[-1][0]['attributes']
                    self.assertEqual(attrs.get('http.response.status_code'),status if isinstance(status,int) else None)
                    self.assertEqual(transport.call_count,2 if status in (503,None,'timeout') else 1)
            for status in (429,400,503):
                spans=[]
                with patch.object(runtime,'telemetry',side_effect=lambda service,ctx,start,name,status:spans.append(ctx)),patch.object(runtime.urllib.request,'urlopen',side_effect=HTTPError('http://local',status,'private',{},io.BytesIO(b'{}'))) as transport:
                    with self.assertRaises(runtime.HttpError) as caught:runtime.upstream('http://local/api/payment/orders',data={})
                self.assertEqual(caught.exception.status,status)
                self.assertEqual(spans[-1]['attributes']['http.response.status_code'],status)
                self.assertEqual(transport.call_count,1)
            # A final connection failure must not retain the first attempt's 503.
            spans=[]
            with patch.object(runtime,'telemetry',side_effect=lambda service,ctx,start,name,status:spans.append(ctx)), patch.object(runtime.urllib.request,'urlopen',side_effect=[HTTPError('http://local',503,'private',{},io.BytesIO(b'{}')),URLError('offline')]),patch.object(runtime.time,'sleep'):
                with self.assertRaises(runtime.HttpError):runtime.request('http://local/api/products')
            self.assertNotIn('http.response.status_code',spans[-1]['attributes'])

    def test_serialized_client_and_receiving_server_status(self):
        import os
        import runtime
        sent=[]
        def handler(req):
            return runtime.request('http://dependency/api/products', method='POST',data={})
        app=runtime.application('gateway',handler)
        error=HTTPError('http://dependency',429,'private',{},io.BytesIO(b'{}'))
        # Queue exports rather than running exporter HTTP requests in the active
        # request context; inspect the payload captured in the send closure.
        def capture(send,url,headers):
            cells=dict(zip(send.__code__.co_freevars,[c.cell_contents for c in send.__closure__]))
            sent.append(cells['payload']['resourceSpans'][0]['scopeSpans'][0]['spans'][0])
            runtime.export_slots.release()
        with patch.dict(os.environ,{'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT':'http://collector'},clear=True),patch.object(runtime.exports,'submit',side_effect=capture),patch.object(runtime.urllib.request,'urlopen',side_effect=error):
            statuses=[]
            app({'PATH_INFO':'/api/products','REQUEST_METHOD':'GET','wsgi.input':io.BytesIO()},lambda status,headers:statuses.append(status))
        self.assertTrue(statuses[0].startswith('502'))
        self.assertEqual([s['kind'] for s in sent],[3,2])
        self.assertEqual([next(a['value']['intValue'] for a in s['attributes'] if a['key']=='http.response.status_code') for s in sent],['429','502'])
        sent.clear()
        with patch.dict(os.environ,{'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT':'http://collector'},clear=True),patch.object(runtime.exports,'submit',side_effect=capture),patch.object(runtime.urllib.request,'urlopen',side_effect=TimeoutError()):
            with self.assertRaises(runtime.HttpError):runtime.request('http://dependency/api/products',method='POST',data={})
        self.assertFalse(any(a['key']=='http.response.status_code' for a in sent[0]['attributes']))
