"""Widget authentication uses one no-retry, metadata-only HTTP client span."""
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

SERVICE=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(SERVICE),str(SERVICE/'lib')]
import widget
import runtime

class Response(io.BytesIO):
    def __init__(self, status=200, body=None):
        super().__init__(json.dumps(body if body is not None else {'user':{'id':'private-user'}}).encode())
        self.status=status

class AuthenticationTracing(unittest.TestCase):
    def setUp(self):
        self.parent=runtime.trace_context('00-'+'a'*32+'-'+'b'*16+'-01','vendor=value')
        self.parent['service']='moks'
        token=runtime.ctx.set(self.parent);self.addCleanup(runtime.ctx.reset,token)
        self.env={'HTTP_ORIGIN':widget.UPSTREAM_ORIGIN,'HTTP_COOKIE':'rs_auth='+'c'*64+'; arbitrary=private-cookie','HTTP_AUTHORIZATION':'browser-token','HTTP_TRACEPARENT':'untrusted-extra-header'}

    def test_connected_gateway_and_user_service_chain(self):
        spans=[];outgoing=[]
        def capture(service,context,start,name,status):
            spans.append((service,dict(context),name,status))
        user_app=runtime.application('user-service',lambda req:{'user':{'id':'private-user'}})
        gateway_app=runtime.application('ai-gateway',lambda req:runtime.request('http://users/internal/session',data={}))
        def transport(req,timeout):
            outgoing.append((req,timeout))
            app=gateway_app if req.full_url.startswith('http://gateway') else user_app
            headers={k.lower():v for k,v in req.header_items()}
            environ={'PATH_INFO':'/api/auth/me' if app is gateway_app else '/internal/session','REQUEST_METHOD':req.get_method(),'wsgi.input':io.BytesIO(),
                     'HTTP_TRACEPARENT':headers['traceparent'],'HTTP_TRACESTATE':headers.get('tracestate','')}
            statuses=[];raw=b''.join(app(environ,lambda s,h:statuses.append(s)))
            response=io.BytesIO(raw);response.status=int(statuses[0].split()[0]);return response
        with patch.dict(os.environ,{'AUTH_URL':'http://gateway/api/auth/me?private=query'}),patch.object(runtime,'telemetry',side_effect=capture),patch.object(widget,'urlopen',side_effect=transport),patch.object(runtime.urllib.request,'urlopen',side_effect=transport):
            self.assertTrue(widget.authenticated(self.env))
        client=next(s for s in spans if s[2]=='GET /api/auth/me' and s[1].get('kind')==3)
        gateway=next(s for s in spans if s[0]=='ai-gateway' and s[1].get('kind',2)==2)
        user=next(s for s in spans if s[0]=='user-service')
        inner=next(s for s in spans if s[2]=='POST /internal/session' and s[1].get('kind')==3)
        self.assertEqual(client[1]['parentSpanId'],self.parent['spanId'])
        self.assertEqual(gateway[1]['parentSpanId'],client[1]['spanId'])
        self.assertEqual(inner[1]['parentSpanId'],gateway[1]['spanId'])
        self.assertEqual(user[1]['parentSpanId'],inner[1]['spanId'])
        self.assertTrue(all(s[1]['traceId']==self.parent['traceId'] for s in spans))
        headers={k.lower():v for k,v in outgoing[0][0].header_items()}
        self.assertEqual(set(headers),{'cookie','traceparent','tracestate'})
        self.assertEqual(headers['cookie'],'rs_auth='+'c'*64)
        self.assertEqual(headers['tracestate'],'vendor=value')
        self.assertEqual(headers['traceparent'],runtime.trace_header(client[1]))
        self.assertEqual(outgoing[0][1],2)
        self.assertEqual(client[1]['attributes']['http.response.status_code'],200)
        self.assertEqual(len([s for s in spans if s[2]=='GET /api/auth/me' and s[1].get('kind')==3]),1)
        for private in ('private-user','private-cookie','browser-token','private=query','c'*64):self.assertNotIn(private,str(spans))

    def test_rejection_timeout_and_connection_have_one_span_and_no_retry(self):
        for status in (401,403,429,None,'timeout'):
            error=TimeoutError() if status=='timeout' else URLError('private-address') if status is None else HTTPError('http://gateway',status,'private',{},io.BytesIO())
            spans=[]
            with patch.object(widget,'urlopen',side_effect=error) as transport,patch.object(runtime,'telemetry',side_effect=lambda *a:spans.append(a)):
                self.assertFalse(widget.authenticated(self.env))
            transport.assert_called_once();self.assertEqual(len(spans),1)
            self.assertEqual(spans[0][1]['attributes'].get('http.response.status_code'),status if isinstance(status,int) else None)
        with patch.object(widget,'urlopen',return_value=Response(body={'user':None})) as transport:
            self.assertFalse(widget.authenticated(self.env));transport.assert_called_once()

    def test_origin_cookie_and_response_bounds(self):
        for values in ({'HTTP_ORIGIN':'https://evil.invalid'}, {'HTTP_COOKIE':'rs_auth=invalid'}, {'HTTP_COOKIE':'other=anything'}):
            with patch.object(widget,'urlopen') as transport:
                self.assertFalse(widget.authenticated({**self.env,**values}));transport.assert_not_called()
        response=Response(body={'user':{'padding':'x'*20000}})
        with patch.object(response,'read',wraps=response.read) as read,patch.object(widget,'urlopen',return_value=response):
            self.assertFalse(widget.authenticated(self.env));read.assert_called_once_with(16384)

    def test_disabled_unsampled_and_failed_telemetry_do_not_affect_auth(self):
        for disabled,flags in [('true','01'),('false','00')]:
            self.parent['flags']=flags
            with patch.dict(os.environ,{'OTEL_SDK_DISABLED':disabled,'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT':'http://unused'}),patch.object(runtime.exports,'submit') as export,patch.object(widget,'urlopen',return_value=Response()) as transport:
                self.assertTrue(widget.authenticated(self.env));export.assert_not_called()
                self.assertTrue(transport.call_args.args[0].get_header('Traceparent').endswith('-'+flags))
        with patch.object(runtime,'telemetry',side_effect=RuntimeError('export failed')),patch.object(widget,'urlopen',return_value=Response()):
            self.assertTrue(widget.authenticated(self.env))
        self.assertIs(runtime.ctx.get(),self.parent)
