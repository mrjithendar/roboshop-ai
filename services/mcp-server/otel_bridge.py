"""Enable FastMCP's native instrumentation; reuse the service's OTLP transport."""
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SpanExporter, SimpleSpanProcessor, SpanExportResult
from opentelemetry.sdk.trace.sampling import ParentBased, ALWAYS_ON
from runtime import telemetry

class Exporter(SpanExporter):
    def export(self, spans):
        try:
            for span in spans:
                sc = span.context
                # FastMCP may attach tool arguments/auth subjects: strict metadata allowlist.
                attrs = {k:v for k,v in (span.attributes or {}).items() if k in
                         {'rpc.system','mcp.method.name','mcp.tool.name','mcp.server.name','http.route','http.request.method'}}
                tool = attrs.get('mcp.tool.name')
                context={'traceId':format(sc.trace_id,'032x'),'spanId':format(sc.span_id,'016x'),
                         'flags':format(int(sc.trace_flags),'02x'),'tracestate':sc.trace_state.to_header(),
                         'kind':span.kind.value,'attributes':attrs,'endTimeUnixNano':span.end_time}
                if span.parent:context['parentSpanId']=format(span.parent.span_id,'016x')
                # No runtime IDs or arguments in names, even for resource-template spans.
                telemetry('mcp-server',context,span.start_time,'mcp.call_tool' if tool else 'mcp.request',
                          503 if span.status.status_code == trace.StatusCode.ERROR else 200)
            return SpanExportResult.SUCCESS
        except Exception:return SpanExportResult.FAILURE

_installed=False
def configure():
    global _installed
    if _installed:return
    provider=TracerProvider(sampler=ParentBased(ALWAYS_ON),shutdown_on_exit=False)
    provider.add_span_processor(SimpleSpanProcessor(Exporter()))
    trace.set_tracer_provider(provider)
    _installed=True
