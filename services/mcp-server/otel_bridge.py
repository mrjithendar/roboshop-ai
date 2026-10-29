"""Enable FastMCP's native instrumentation; reuse the service's OTLP transport."""
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SpanExporter, SimpleSpanProcessor, SpanExportResult
from opentelemetry.sdk.trace.sampling import ParentBased, ALWAYS_ON
from runtime import telemetry
from gateway_tools import TOOLS
TOOL_NAMES = {item.name for item in TOOLS}
# Stable span names; FastMCP's own names embed the tool name.
SPAN_NAMES = {'tools/call': 'mcp.call_tool', 'tools/list': 'mcp.list_tools', 'initialize': 'mcp.initialize', 'ping': 'mcp.ping'}
OUTCOMES = {'success', 'confirmation_requested', 'admission_rejected', 'invalid_argument', 'unauthenticated', 'forbidden',
            'not_found', 'conflict', 'rate_limited', 'dependency_unavailable', 'invalid_response', 'timeout',
            'confirmation_required', 'confirmation_declined', 'confirmation_unavailable'}
MAX_BODY = 262144

class Exporter(SpanExporter):
    def export(self, spans):
        try:
            for span in spans:
                sc = span.context
                # FastMCP may attach tool arguments/auth subjects: strict metadata allowlist.
                attrs = {k:v for k,v in (span.attributes or {}).items() if k in
                         {'rpc.system','mcp.method.name','mcp.tool.name','mcp.server.name','gen_ai.tool.name','http.route',
                          'http.request.method','mcp.tool.outcome','error.type'}}
                tool = attrs.get('gen_ai.tool.name') or attrs.get('mcp.tool.name')
                if tool and tool not in TOOL_NAMES:
                    attrs['gen_ai.tool.name']='unknown'
                attrs.pop('mcp.tool.name', None)
                for key in ('mcp.tool.outcome', 'error.type'):
                    if key in attrs and attrs[key] not in OUTCOMES:
                        attrs[key] = 'other'
                if attrs.get('mcp.method.name') not in {'tools/call','tools/list','resources/read','resources/list','resources/templates/list','prompts/get','prompts/list','initialize','ping','server/discover'}:
                    attrs['mcp.method.name']='other'
                # OTLP numbers span kinds from 1 (internal); the Python enum starts at 0.
                context={'traceId':format(sc.trace_id,'032x'),'spanId':format(sc.span_id,'016x'),
                         'flags':format(int(sc.trace_flags),'02x'),'tracestate':sc.trace_state.to_header(),
                         'kind':span.kind.value+1,'attributes':attrs,'endTimeUnixNano':span.end_time}
                if span.parent:context['parentSpanId']=format(span.parent.span_id,'016x')
                # No runtime IDs or arguments in names, even for resource-template spans.
                telemetry('mcp-server',context,span.start_time,SPAN_NAMES.get(attrs['mcp.method.name'],'mcp.request'),
                          503 if span.status.status_code == trace.StatusCode.ERROR else 200)
            return SpanExportResult.SUCCESS
        except Exception:return SpanExportResult.FAILURE

_installed=False
def configure():
    global _installed
    if _installed or os.getenv('OTEL_SDK_DISABLED') == 'true':return
    provider=TracerProvider(sampler=ParentBased(ALWAYS_ON),shutdown_on_exit=False)
    provider.add_span_processor(SimpleSpanProcessor(Exporter()))
    trace.set_tracer_provider(provider)
    _installed=True

class HTTPTracing:
    """Transport span is separate from FastMCP's native tool operation spans; also bounds request bodies."""
    def __init__(self, app):self.app,self.router=app,getattr(app,'router',None)
    async def __call__(self, scope, receive, send):
        if scope['type']!='http':return await self.app(scope,receive,send)
        from runtime import ctx, trace_context, telemetry
        from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags, TraceState
        import time
        headers=dict(scope.get('headers',[]))
        length=headers.get(b'content-length',b'0')
        if not length.isdigit() or int(length)>MAX_BODY:
            await send({'type':'http.response.start','status':413,'headers':[(b'content-type',b'application/json')]})
            return await send({'type':'http.response.body','body':b'{"error":"Request too large"}'})
        context=trace_context(headers.get(b'traceparent',b'').decode('ascii',errors='ignore'),headers.get(b'tracestate',b'').decode('ascii',errors='ignore'))
        context['service']='mcp-server'
        route=scope.get('path') if scope.get('path') in ('/mcp','/mcp/','/ready','/health') else ''
        method=scope['method'] if scope['method'] in ('GET','POST','DELETE','HEAD','OPTIONS') else 'HTTP'
        context['attributes']={'http.route':route,'http.request.method':method}
        token=ctx.set(context);start=time.time_ns();status=500;received=0
        sc=SpanContext(int(context['traceId'],16),int(context['spanId'],16),False,TraceFlags(int(context['flags'],16)),TraceState.from_header([context['tracestate']]))
        async def bounded():
            nonlocal received
            message=await receive()
            received+=len(message.get('body',b''))
            if received>MAX_BODY:return {'type':'http.disconnect'}
            return message
        async def respond(message):
            nonlocal status
            if message['type']=='http.response.start':status=message['status']
            await send(message)
        try:
            with trace.use_span(NonRecordingSpan(sc),end_on_exit=False,record_exception=False,set_status_on_exception=False):
                await self.app(scope,bounded,respond)
        finally:
            try:telemetry('mcp-server',context,start,(method+' '+route).rstrip(),status)
            except Exception:pass  # Telemetry never changes the response.
            ctx.reset(token)
