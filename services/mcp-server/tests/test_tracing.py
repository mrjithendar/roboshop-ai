import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'lib')]
from fastmcp import Client
from server import create_server
from otel_bridge import configure,HTTPTracing
from runtime import ctx

class MCPTracing(unittest.IsolatedAsyncioTestCase):
 async def test_native_tool_span_parents_gateway_work(self):
  configure();spans=[];outgoing=[]
  def fetch(*args,**kwargs):outgoing.append(dict(ctx.get() or {}));return {'products':[]}
  with patch('otel_bridge.telemetry',side_effect=lambda *args:spans.append(args)):
   async with Client(create_server(fetcher=fetch)) as client:
    await client.call_tool('search_products',{'query':'private query'})
  self.assertTrue(outgoing[0].get('spanId'))
  tools=[s for s in spans if s[3]=='mcp.call_tool' and s[1]['kind']==2]
  self.assertEqual(len(tools),1)
  self.assertTrue(any(s[1]['spanId']==outgoing[0]['spanId'] for s in spans))
  self.assertNotIn('private query',str(spans))
 async def test_transport_parent_and_unknown_route(self):
  from opentelemetry import trace
  spans=[];seen=[]
  async def app(scope,receive,send):
   seen.append(trace.get_current_span().get_span_context())
   await send({'type':'http.response.start','status':404,'headers':[]})
  async def send(message):pass
  scope={'type':'http','path':'/private-user-id','method':'GET','headers':[(b'traceparent',b'00-'+b'a'*32+b'-'+b'b'*16+b'-01')]}
  with patch('runtime.telemetry',side_effect=lambda *args:spans.append(args)):
   await HTTPTracing(app)(scope,None,send)
  self.assertEqual(spans[0][3],'GET');self.assertEqual(spans[0][1]['traceId'],'a'*32)
  self.assertEqual(format(seen[0].span_id,'016x'),spans[0][1]['spanId'])
