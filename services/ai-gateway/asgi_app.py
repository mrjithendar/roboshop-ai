"""Native ASGI transport around the existing authenticated application boundary.

Blocking Mongo/Redis/SDK operations use a bounded worker pool. Cancellation drains
an in-flight mutation: disconnecting a browser never retries or rolls back payment.
No WSGI server or ASGI-to-WSGI middleware is used.
"""
import io
import os
import json
import time
import threading
from collections import Counter
from contextlib import asynccontextmanager
import anyio
from fastapi import FastAPI, Request as ASGIRequest
from fastapi.responses import Response
from starlette.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from server import Gateway  # establishes the service-local library path
from runtime import Request, HttpError, encode, trace_context, ctx, telemetry, configure_telemetry, deadline, log_event, operation_name, error_details, SAFE_ERRORS
from api_models import ChatRequest, ChatResponse, HealthResponse, ErrorResponse
from readiness import gateway_readiness

SECURITY = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://*.razorpay.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com https://challenges.cloudflare.com; connect-src 'self' https://*.razorpay.com https://challenges.cloudflare.com; frame-src https://*.razorpay.com https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}

class TransportRequest(Request):
    def __init__(self, request, body):
        environ = {'REQUEST_METHOD': request.method, 'PATH_INFO': request.url.path,
                   'QUERY_STRING': request.url.query, 'CONTENT_TYPE': request.headers.get('content-type', ''),
                   'CONTENT_LENGTH': str(len(body)), 'wsgi.input': io.BytesIO(body),
                   'REMOTE_ADDR': request.client.host if request.client else ''}
        environ.update({'HTTP_' + k.upper().replace('-', '_'): v for k, v in request.headers.items()})
        super().__init__(environ)


def create_app(gateway=None):
    @asynccontextmanager
    async def lifespan(app):
        if gateway is not None:
            app.state.gateway = gateway
            yield
            return
        from lifecycle import resources
        owner = resources()
        app.state.gateway = await anyio.to_thread.run_sync(owner.__enter__)
        try:
            yield
        finally:
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(lambda: owner.__exit__(None, None, None))

    app = FastAPI(title='RoboShop AI Gateway', version='1.0.0', lifespan=lifespan)
    app.add_middleware(CORSMiddleware,
        allow_origins=[os.getenv('PUBLIC_ORIGIN', 'http://localhost:3000')],
        allow_credentials=True, allow_methods=['GET','POST','PUT','PATCH','DELETE','HEAD'],
        allow_headers=['Content-Type','Idempotency-Key','Authorization','X-Request-ID'],
        expose_headers=['X-Request-ID'])
    if gateway is not None:
        app.state.gateway = gateway
    slots = threading.BoundedSemaphore(8)
    counts = Counter()
    durations = [0.0]
    configure_telemetry('ai-gateway')

    async def dispatch(request: ASGIRequest):
        start = time.time_ns()
        context = trace_context(request.headers.get('traceparent'))
        context['service'] = 'ai-gateway'
        token = ctx.set(context)
        req, extra, status = None, [], 200
        # Fixed categories keep SKU/user IDs and prompts out of logs and metrics.
        category = request.url.path.split('/')[2:3] if request.url.path.startswith('/api/') else []
        route = '/api/' + category[0] if category and category[0] in {'auth','account','admin','products','cart','orders','payments','shipping','chat','ready','status','settings','compare','recommendations','catalogue','ops'} else 'other'
        try:
            if request.method == 'GET' and request.url.path in ('/health', '/health/live'):
                result = HealthResponse(status='ok', service='ai-gateway').model_dump()
            elif request.method == 'GET' and request.url.path == '/metrics':
                rows = ['# TYPE roboshop_http_requests_total counter']
                rows += [f'roboshop_http_requests_total{{service="ai-gateway",route="{r}",status="{s}"}} {n}' for (r,s),n in counts.items()]
                rows += ['# TYPE roboshop_http_duration_seconds summary', f'roboshop_http_duration_seconds_sum{{service="ai-gateway"}} {durations[0]}', f'roboshop_http_duration_seconds_count{{service="ai-gateway"}} {sum(counts.values())}']
                result, extra = ('\n'.join(rows)+'\n').encode(), [('Content-Type','text/plain; version=0.0.4')]
            else:
                if sum(len(k)+len(v) for k,v in request.scope['headers']) > 16384:
                    raise HttpError(431, 'Headers too large')
                body = bytearray()
                with anyio.fail_after(10):
                    async for chunk in request.stream():
                        body.extend(chunk)
                        if len(body) > 65536:
                            raise HttpError(413, 'Request too large')
                req = TransportRequest(request, bytes(body))
                if not slots.acquire(blocking=False):
                    raise HttpError(503, 'Gateway busy')
                def invoke():
                    deadline_token = deadline.set(time.monotonic() + 23)
                    try:
                        if req.method == 'GET' and req.path == '/health/ready':
                            return gateway_readiness(app.state.gateway)
                        value = app.state.gateway.handle(req)
                        if value is None:
                            raise HttpError(404, 'Not found')
                        # Validation occurs after domain authorization, so schemas cannot
                        # bypass or disclose authentication decisions.
                        if req.path == '/api/chat' and req.method == 'POST' and isinstance(value, dict):
                            ChatResponse.model_validate(value)
                        return value
                    finally:
                        deadline.reset(deadline_token)
                        slots.release()
                # Do not abandon a mutating thread on client cancellation. The durable
                # checkout state machine owns retries and reconciliation, not ASGI.
                with anyio.CancelScope(shield=True):
                    result = await anyio.to_thread.run_sync(invoke, abandon_on_cancel=False)
                if isinstance(result, tuple):
                    result, status, extra = result
        except HttpError as error:
            log_event("request_rejected", "WARN", route=route, method=request.method, status=error.status, errorType=type(error).__name__, **error_details(error))
            status = error.status
            result = ErrorResponse(error=str(error) if str(error) in SAFE_ERRORS else 'The request could not be completed.', requestId=context['traceId']).model_dump()
            result['code'] = error_details(error)['errorCode']
            if getattr(error, 'code', None) == 'CHECKOUT_QUOTE_INVALID':
                result.update(code=error.code, error='Refresh your checkout total and choose an enabled payment currency before paying.')
        except TimeoutError:
            status, result = 408, {'error':'Request timed out.', 'requestId':context['traceId']}
        except ValidationError:
            status, result = 502, {'error':'Invalid service response.', 'requestId':context['traceId']}
        except Exception as error:
            log_event("request_failed", "ERROR", route=route, method=request.method, status=500, errorType=type(error).__name__)
            status, result = 500, {'error':'Internal service error.', 'requestId':context['traceId']}
        finally:
            elapsed = (time.time_ns()-start)/1e9
            if request.url.path not in ('/health','/health/live','/metrics'):
                counts[(route,status)] += 1
                durations[0] += elapsed
                probe = request.url.path in ('/health/ready', '/api/ready')
                log_event('request_completed', 'WARN' if status >= 400 else 'DEBUG' if probe else 'INFO', route=route, operation=operation_name(request.url.path), method=request.method, outcome="failure" if status >= 400 else "success", status=status, durationMs=round(elapsed*1000))
                telemetry('ai-gateway', context, start, request.method+' '+route, status)
            ctx.reset(token)
        payload = result if isinstance(result, bytes) else encode(result)
        headers = {**SECURITY, 'Content-Type':'application/json; charset=utf-8', 'X-Request-ID':context['traceId']}
        # Preserve existing first-value-wins header semantics and all Set-Cookies.
        for k,v in reversed(extra):
            headers[k] = v
        response = Response(b'' if request.method == 'HEAD' else payload, status_code=status, headers=headers)
        for k,v in req.cookies if req else []:
            response.raw_headers.append((k.lower().encode(),v.encode()))
        return response

    # Typed documentation for AI, with all original URLs handled through the same
    # domain authorization boundary (including raw signed webhook bytes).
    app.add_api_route('/api/chat', dispatch, methods=['POST'], response_model=ChatResponse,
                      openapi_extra={'requestBody': {'required': True, 'content': {'application/json': {'schema': ChatRequest.model_json_schema()}}}})
    app.add_api_route('/api/admin/llm/status', dispatch, methods=['GET'])
    app.add_api_route('/health/live', dispatch, methods=['GET'], response_model=HealthResponse)
    app.add_api_route('/health/ready', dispatch, methods=['GET'])
    app.add_api_route('/{path:path}', dispatch, methods=['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'], include_in_schema=False)
    return app
