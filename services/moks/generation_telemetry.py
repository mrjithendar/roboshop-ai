"""SDK generation spans bridged into the existing bounded OTLP export path.

One provider attempt => one SDK span => one export to each configured backend.
No second global provider, auto-instrumentation or provider invocation is installed.
"""
from contextlib import contextmanager
import json
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.sdk.trace.sampling import ParentBased, ALWAYS_ON
from runtime import ctx, telemetry

class ExistingExporter(SpanExporter):
    def export(self, spans):
        try:
            for span in spans:
                sc = span.context
                context = {'traceId': format(sc.trace_id, '032x'), 'spanId': format(sc.span_id, '016x'),
                           'flags': format(int(sc.trace_flags), '02x'), 'tracestate': sc.trace_state.to_header(),
                           'attributes': dict(span.attributes or {}), 'kind': 3, 'endTimeUnixNano': span.end_time}
                if span.parent: context['parentSpanId'] = format(span.parent.span_id, '016x')
                telemetry('moks', context, span.start_time, span.name, 503 if span.status.status_code == trace.StatusCode.ERROR else 200)
            return SpanExportResult.SUCCESS
        except Exception:
            return SpanExportResult.FAILURE  # Telemetry must never affect inference.

_provider = TracerProvider(sampler=ParentBased(ALWAYS_ON), shutdown_on_exit=False)
_provider.add_span_processor(SimpleSpanProcessor(ExistingExporter()))
_tracer = _provider.get_tracer('roboshop.moks.generations', '1')

@contextmanager
def generation(attributes):
    parent = ctx.get() or {}
    parent_context = None
    if parent.get('traceId'):
        sc = trace.SpanContext(int(parent['traceId'],16), int(parent['spanId'],16), False,
                              trace.TraceFlags(int(parent.get('flags','01'),16)),
                              trace.TraceState.from_header([parent.get('tracestate','')]))
        parent_context = trace.set_span_in_context(trace.NonRecordingSpan(sc))
    # Do not record exception messages or stack traces (they may contain secrets).
    with _tracer.start_as_current_span('llm.generate', context=parent_context, kind=trace.SpanKind.CLIENT,
                                      record_exception=False, set_status_on_exception=False) as span:
        sc = span.get_span_context()
        token = ctx.set({**parent, 'traceId':format(sc.trace_id,'032x'), 'spanId':format(sc.span_id,'016x'), 'service':'moks'})
        try:
            yield span
        except Exception:
            span.set_status(trace.Status(trace.StatusCode.ERROR))
            raise
        finally:
            span.set_attributes(attributes)
            ctx.reset(token)

def usage_metadata(result):
    # Missing usage remains missing, never zero. Cache counts are distinct Bedrock
    # billing categories; do not synthesize totals or infer reasoning token counts.
    mapping = {'input_tokens':'input', 'output_tokens':'output',
               'cache_read_input_tokens':'cache_read_input_tokens',
               'cache_write_input_tokens':'cache_write_input_tokens'}
    usage = {target: result[source] for source,target in mapping.items()
             if type(result.get(source)) is int and result[source] >= 0}
    return {'langfuse.observation.usage_details':json.dumps(usage)} if usage else {}


def capture_synthetic_content(attributes, prompt, response=None):
    # Real customer chat stays metadata-only even if an operator enables capture.
    if os.getenv('LANGFUSE_CAPTURE_CONTENT') != 'synthetic-only' or (ctx.get() or {}).get('traffic') != 'evaluation': return
    import re
    def redact(value):
        value=re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', value)
        value=re.sub(r'(?i)(bearer\s+\S+|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+)', '[credential]', value)
        value=re.sub(r'\b(?:\d[ -]?){10,19}\b', '[number]', value)
        return value[:8000]
    attributes['langfuse.observation.input']=redact(prompt)
    if response is not None: attributes['langfuse.observation.output']=redact(response)
