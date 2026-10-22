import io
import json
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch
sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'lib')]
import runtime
from trace_routes import route_template,http_name
from generation_telemetry import usage_metadata
from providers import invoke

class TracingTests(unittest.TestCase):
 def test_templates_and_unmatched_never_include_input(self):
  for path,expected in [('/api/products/private-id/reviews','/api/products/{product_id}/reviews'),('/roboshop/api/products/secret?token=private','/roboshop/api/products/{product_id}'),('/api/catalogue/search/email@example.com','/api/catalogue/search/{query}'),('/internal/carts/private/clear-checked','/internal/carts/{cart_id}/clear-checked')]:
   self.assertEqual(route_template(path),expected)
  self.assertEqual(http_name('GET','/arbitrary/private?token=secret'),'GET')
 def test_connected_http_server_client_and_tracestate(self):
  captured=[]
  def handler(req):
   runtime.request('http://catalogue/api/products?query=private')
   return {'ok':True}
  def send(url,*args,**kwargs):
   self.assertEqual(runtime.propagation_headers()['tracestate'],'vendor=value');return {}
  app=runtime.application('moks',handler)
  with patch.object(runtime,'_request',side_effect=send),patch.object(runtime,'telemetry',side_effect=lambda *args:captured.append(args)):
   app({'PATH_INFO':'/internal/chat','REQUEST_METHOD':'POST','HTTP_TRACEPARENT':'00-'+'a'*32+'-'+'b'*16+'-01','HTTP_TRACESTATE':'vendor=value','wsgi.input':io.BytesIO()},lambda *args:None)
  self.assertEqual(len(captured),2)
  client,server=captured
  self.assertEqual(client[1]['parentSpanId'],server[1]['spanId'])
  self.assertEqual(client[1]['traceId'],'a'*32);self.assertEqual(server[1]['parentSpanId'],'b'*16)
  self.assertEqual(server[3],'POST /internal/chat');self.assertNotIn('private',str(captured))
 def test_resources_noise_redaction_and_langfuse_selection(self):
  sent=[]
  env={'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT':'http://collector/v1/traces','LANGFUSE_BASE_URL':'https://us.cloud.langfuse.com','LANGFUSE_PUBLIC_KEY':'pk-test','LANGFUSE_SECRET_KEY':'sk-test','OTEL_SERVICE_VERSION':'commit-123','DEPLOYMENT_ENVIRONMENT':'unit-test','POD_UID':'pod-1'}
  c=runtime.trace_context();c['attributes']={'http.route':'/ready','authorization':'private','db.statement':'sensitive'}
  with patch.dict(os.environ,env,clear=True),patch.object(runtime,'_request',side_effect=lambda *args,**kw:sent.append(args)),patch.object(runtime.exports,'submit',side_effect=lambda fn,*args:fn(*args)):
   runtime.telemetry('moks',c,time.time_ns(),'GET /ready',200);self.assertEqual(sent,[])
   runtime.telemetry('moks',c,time.time_ns(),'GET /ready',503);self.assertEqual(len(sent),1)
   c['attributes']={'langfuse.observation.type':'generation','gen_ai.usage.input_tokens':4,'authorization':'private'}
   runtime.telemetry('moks',c,time.time_ns(),'llm.generate',200);self.assertEqual(len(sent),3)
  resources={a['key']:a['value']['stringValue'] for a in sent[-1][1]['resourceSpans'][0]['resource']['attributes']}
  self.assertEqual(resources['service.namespace'],'roboshop-ai');self.assertEqual(resources['service.version'],'commit-123');self.assertEqual(resources['service.instance.id'],'pod-1')
  self.assertNotIn('private',json.dumps(sent));self.assertNotIn('sensitive',json.dumps(sent))
 def test_real_sdk_generation_once_and_unknown_cost_not_zero(self):
  config={'provider':'bedrock','region':'us-east-1','model':'global.amazon.nova-2-lite-v1:0'}
  result={'answer':'ok','input_tokens':20,'output_tokens':4,'cache_read_input_tokens':2}
  captured=[]
  with patch('bedrock_provider.generate',return_value=result),patch('generation_telemetry.telemetry',side_effect=lambda *args:captured.append(args)):
   with runtime.trace_span('shopping_agent.recommend') as parent:
    invoke(config,'secret instructions','private input')
  self.assertEqual(len(captured),1);span=captured[0][1]
  self.assertEqual(span['parentSpanId'],parent['spanId']);self.assertEqual(captured[0][3],'llm.generate')
  attrs=span['attributes'];self.assertEqual(attrs['aws.bedrock.inference_profile.id'],config['model'])
  self.assertEqual(json.loads(attrs['langfuse.observation.usage_details']),{'input':20,'output':4,'cache_read_input_tokens':2})
  self.assertNotIn('cost_details',str(attrs));self.assertNotIn('private input',str(captured))
  self.assertEqual(usage_metadata({}),{})
 def test_export_disabled_or_closed_does_not_fail(self):
  c=runtime.trace_context();c['attributes']={'langfuse.observation.type':'generation'}
  with patch.dict(os.environ,{'OTEL_SDK_DISABLED':'true'}),patch.object(runtime.exports,'submit') as send:
   runtime.telemetry('moks',c,time.time_ns(),'llm.generate',200);send.assert_not_called()
  with patch.dict(os.environ,{'OTEL_SDK_DISABLED':'false','OTEL_EXPORTER_OTLP_TRACES_ENDPOINT':'http://collector'}),patch.object(runtime.exports,'submit',side_effect=RuntimeError('closed')):
   runtime.telemetry('moks',c,time.time_ns(),'llm.generate',200)
 def test_unsampled_parent_no_generation_export(self):
  c=runtime.trace_context('00-'+'a'*32+'-'+'b'*16+'-00');token=runtime.ctx.set(c)
  try:
   with patch('bedrock_provider.generate',return_value={'answer':'ok'}),patch('generation_telemetry.telemetry') as send:
    invoke({'provider':'bedrock','region':'us-east-1','model':'mock'},'s','p');send.assert_not_called()
  finally:runtime.ctx.reset(token)
