import {routeTemplate, quietRoute, httpName, traceState} from './trace-routes.mjs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const context = new AsyncLocalStorage();

let logService = process.env.OTEL_SERVICE_NAME || 'roboshop';
const logFields = new Set('method route operation status durationMs dependency operation errorType errorCode provider reason revision port state attempt maxAttempts outcome'.split(' '));
const logMessages = {
  "user_logged_in": "User logged in successfully",
  "user_login_failed": "User failed to log in",
  "user_login_mfa_required": "Password accepted; waiting for second-factor verification",
  "user_registered": "User account created",
  "user_logged_out": "User logged out",
  "authentication_challenge_passed": "Human verification passed",
  "authentication_challenge_rejected": "Human verification rejected",
  "request_completed": "HTTP request completed",
  "request_failed": "Request failed",
  "request_rejected": "Request rejected",
  "dependency_call_completed": "Dependency request completed",
  "dependency_retry_scheduled": "Dependency unavailable; retrying a safe read",
  "service_starting": "Starting service",
  "service_listening": "Service listening for requests",
  "service_stopping": "Stopping service",
  "cart_updated": "Cart saved",
  "cart_update_rejected": "Cart update rejected; refresh the cart",
  "checkout_reserved": "Checkout reserved; creating payment order",
  "checkout_payment_captured": "Payment captured and order confirmed",
  "checkout_reconciliation_required": "Payment outcome uncertain; reconciliation required",
  "order_event_published": "Order event delivered to RabbitMQ",
  "delivery_retry": "Kafka delivery not confirmed; message retained for retry",
  "event_delivered": "Order event delivered to Kafka",
  "invalid_event_quarantined": "Invalid order event moved to quarantine"
};
export function logEvent(event, fields = {}, level = 'INFO') {
  if (fields.status >= 500) level = 'ERROR';
  const levels = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
  if ((levels[level] || 20) < (levels[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] || 20)) return;
  const ctx = context.getStore();
  const safe = Object.fromEntries(Object.entries(fields).filter(([k, v]) => logFields.has(k) && ['string','number','boolean'].includes(typeof v)));
  try {
    const message = logMessages[event] || event.replaceAll('_', ' ');
    const record = {timestamp:new Date().toISOString(),level,service:ctx?.service || logService,event,message,...(ctx?.traceId ? {traceId:ctx.traceId,trace_id:ctx.traceId,span_id:ctx.spanId}:{}),...safe};
    if ((process.env.LOG_FORMAT || 'json').toLowerCase() === 'text') {
      const details = Object.entries(record).filter(([key])=>!['timestamp','level','service','message','event'].includes(key)).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join(' ');
      console.log(`${record.timestamp} ${level.padEnd(5)} [${record.service}] ${message} | event=${event} ${details}`.trimEnd());
    } else console.log(JSON.stringify(record));
  }
  catch { /* Logging must not change the request outcome. */ }
}

export const urls = {
  ...(process.env.CART_URL ? { cart: process.env.CART_URL } : {}),
  catalogue: process.env.CATALOGUE_URL || 'http://127.0.0.1:4108',
  recommendations: process.env.RECOMMENDATION_URL || process.env.CATALOGUE_URL || 'http://127.0.0.1:4108',
  agent: process.env.AGENT_URL || 'http://127.0.0.1:4103',
  shipping: process.env.SHIPPING_URL || 'http://127.0.0.1:4106',
  payment: process.env.PAYMENT_URL || 'http://127.0.0.1:4105',
};
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
export async function body(req, limit = 16384) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new HttpError(413, 'Request is too large.');
    chunks.push(bytes);
  }
  // Decode once: UTF-8 characters can span TCP chunks (e.g. worldwide addresses).
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new HttpError(400, 'Expected a JSON object.'); }
}
export function text(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${name} must contain 1–${max} characters.`);
  return value.trim();
}
export function configureTelemetry(service) { logService = service; }
export async function businessSpan(name, work) { return clientSpan(name, work, {}, 1); }
export async function clientSpan(name, work, attributes = {}, kind = 3) {
  const parent = context.getStore();
  const ctx = { traceId: parent?.traceId || randomBytes(16).toString('hex'), spanId: randomBytes(8).toString('hex'), parentSpanId: parent?.spanId, tracestate: parent?.tracestate || "", quiet: parent?.quiet || quietRoute(attributes["url.template"] || ""), flags: parent?.flags || '01', service: parent?.service || process.env.OTEL_SERVICE_NAME || logService, kind, attributes: {} };
  const start = Date.now(); let status = 200;
  return context.run(ctx, async () => {
    try { const result = await work(ctx); if (typeof result?.ok === "boolean" && Number.isInteger(result.status)) status = result.status; if (Number.isInteger(result?.status)) ctx.httpResponseStatus = result.status; return result; }
    catch (error) { status = error.status || 503; throw error; }
    finally {
      logEvent('dependency_call_completed', {operation: name, dependency: attributes['server.address'], status, durationMs: Date.now()-start}, status >= 400 ? 'WARN' : 'INFO');
      exportSpan(ctx.service, ctx, start, name, status, attributes);
    }
  });
}
async function fetchReadRetry(url, options) {
  const method = (options.method || 'GET').toUpperCase();
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try {
      delete context.getStore()?.httpResponseStatus;
      response = await fetch(url, {...options, signal});
      if (context.getStore()) context.getStore().httpResponseStatus = response.status;
      if (![502,503,504].includes(response.status)) return response;
    } catch (error) {
      if (!(error instanceof TypeError) || signal.aborted || attempt === 2 || !['GET','HEAD'].includes(method) || options.body != null) throw error;
    }
    if (attempt === 2 || !['GET','HEAD'].includes(method) || options.body != null || /\/(health|ready|metrics)$/.test(new URL(url).pathname)) {
      if (response) return response;
      throw new Error('Dependency unavailable');
    }
    await response?.body?.cancel();
    logEvent('dependency_retry_scheduled', {dependency:new URL(url).hostname,method,attempt:2,maxAttempts:2,reason:'transient_read_failure'}, 'WARN');
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random()*100));
    signal.throwIfAborted();
  }
}
export async function request(url, options = {}) {
  return clientSpan(httpName(options.method || 'GET', url), async ctx => {
    const headers = { 'content-type': 'application/json', ...options.headers, traceparent: `00-${ctx.traceId}-${ctx.spanId}-${ctx.flags}`, ...(ctx.tracestate ? {tracestate:ctx.tracestate} : {}) };
    try {
      const response = await fetchReadRetry(url, { ...options, headers });
      if (!response.ok) { logEvent('dependency_response_rejected', {dependency: new URL(url).hostname, status: response.status}, 'WARN'); throw new HttpError(502, 'A dependent service is unavailable.'); }
      return await response.json();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(503, 'A dependent service is unavailable. Please try again.');
    }
  }, { 'url.template': routeTemplate(url), 'server.address': new URL(url).hostname, 'http.request.method': options.method || 'GET' });
}
let pendingExports = 0;
export function exportSpan(service, ctx, start, name, status, attributes = {}) {
  if (process.env.OTEL_SDK_DISABLED === 'true' || ctx.flags === '00') return;
  if (status < 400 && (ctx.quiet || quietRoute(attributes['http.route'] || attributes['url.template'] || ''))) return;
  attributes = Object.fromEntries(Object.entries(attributes).filter(([key]) => !/(authorization|cookie|password|secret|token|prompt|completion|db\.statement|db\.query|url\.full|url\.query|http\.url|http\.target|client\.address)/i.test(key)));
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const targets = [];
  if (endpoint) targets.push([endpoint, {}]);
  if (!targets.length || pendingExports >= 32) return;
  const payload = { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }, {key:'service.namespace',value:{stringValue:process.env.OTEL_SERVICE_NAMESPACE || 'roboshop-ai'}}, {key:'service.instance.id',value:{stringValue:process.env.POD_UID || process.env.HOSTNAME || 'local'}}, { key: 'service.version', value: { stringValue: process.env.OTEL_SERVICE_VERSION || 'unknown' } }, { key: 'deployment.environment.name', value: { stringValue: process.env.DEPLOYMENT_ENVIRONMENT || 'development' } }] }, scopeSpans: [{ scope: { name: 'roboshop.manual', version: '0.1.0' }, spans: [{
    traceId: ctx.traceId, spanId: ctx.spanId, ...(ctx.parentSpanId ? { parentSpanId: ctx.parentSpanId } : {}), name, kind: ctx.kind || 2, flags: parseInt(ctx.flags || '01',16), traceState: ctx.tracestate || '',
    startTimeUnixNano: String(BigInt(start) * 1000000n), endTimeUnixNano: String(BigInt(Date.now()) * 1000000n),
    status: { code: status >= 400 ? 2 : 0 },
    attributes: Object.entries({ ...((ctx.kind || 2) === 2 ? {'http.response.status_code': status} : Number.isInteger(ctx.httpResponseStatus) ? {'http.response.status_code': ctx.httpResponseStatus} : {}), ...attributes }).map(([key, value]) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: String(value) } })),
  }] }] }] };
  for (const [url, headers] of targets) {
    pendingExports++;
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(2000) })
      .then(r => { if (!r.ok) console.error(JSON.stringify({ service, event: 'telemetry_export_failed', status: r.status })); })
      .catch(() => console.error(JSON.stringify({ service, event: 'telemetry_export_failed' })))
      .finally(() => pendingExports--);
  }
}
export function serve(service, port, handler) {
  logService = service;
  const counts = new Map();
  let duration = 0, requests = 0;
  // Cumulative per-route latency buckets in seconds (Prometheus defaults).
  const bounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  const latency = new Map(), started = Date.now() / 1000;
  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    let incoming = /^00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])$/.exec(req.headers.traceparent || '');
    if (incoming && (/^0+$/.test(incoming[1]) || /^0+$/.test(incoming[2]))) incoming = null;
    const ctx = { traceId: incoming?.[1] || randomBytes(16).toString('hex'), spanId: randomBytes(8).toString('hex'), parentSpanId: incoming?.[2], tracestate: incoming ? traceState(req.headers.tracestate) : "", flags: incoming?.[3] || '01', service, attributes: {} };
    res.setHeader('x-request-id', ctx.traceId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' https://*.razorpay.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    await context.run(ctx, async () => {
      let route = 'unknown', probe = false, pathname = '';
      try {
        const url = new URL(req.url, 'http://localhost');
        pathname = url.pathname;
        probe = pathname.endsWith('/ready');
        route = routeTemplate(url.pathname);
        ctx.attributes = {'http.route':route, 'http.request.method':req.method};
        ctx.quiet = quietRoute(route);
        if (url.pathname === '/health' && req.method === 'GET') return json(res, { status: 'ok', service });
        if (url.pathname === '/metrics' && req.method === 'GET') {
          const rows = ['# TYPE roboshop_http_requests_total counter'];
          for (const [labels, count] of counts) rows.push(`roboshop_http_requests_total{service="${service}",${labels}} ${count}`);
          rows.push('# TYPE roboshop_http_duration_seconds summary', `roboshop_http_duration_seconds_sum{service="${service}"} ${duration}`, `roboshop_http_duration_seconds_count{service="${service}"} ${requests}`);
          rows.push('# TYPE http_server_request_duration_seconds histogram');
          for (const [r, h] of latency) {
            const labels = `service="${service}",route="${r}"`;
            bounds.forEach((b, i) => rows.push(`http_server_request_duration_seconds_bucket{${labels},le="${b}"} ${h.buckets[i]}`));
            rows.push(`http_server_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`, `http_server_request_duration_seconds_sum{${labels}} ${h.sum}`, `http_server_request_duration_seconds_count{${labels}} ${h.count}`);
          }
          rows.push('# TYPE roboshop_process_start_time_seconds gauge', `roboshop_process_start_time_seconds{service="${service}"} ${started}`, '');
          res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
          return res.end(rows.join('\n'));
        }
        await handler(req, res, url);
        if (!res.writableEnded) json(res, { error: 'Not found.' }, 404);
      } catch (e) {
        logEvent('request_failed', {method: req.method, status: e.status || 500, errorType: e.constructor?.name || 'Error', errorCode: `HTTP_${e.status || 500}`, reason: e.status === 401 ? 'authentication_required_or_invalid_credentials' : e.status === 403 ? 'permission_denied' : e.status === 429 ? 'rate_limited' : e.status >= 500 ? 'dependency_or_service_failure' : 'request_rejected'}, e.status && e.status < 500 ? 'WARN' : 'ERROR');
        if (!res.headersSent) json(res, { error: e.status ? e.message : 'Internal service error.', code: `HTTP_${e.status || 500}`, requestId: ctx.traceId }, e.status || 500);
        else res.end();
      } finally {
        if (!quietRoute(route) || res.statusCode >= 400) {
          // Route labels deliberately omit query strings, SKUs, cookies and prompts.
          const safeRoute = route;
          const operations = {
            '/api/payment/orders':'payment_order_creation', '/api/payment/verify':'payment_verification',
            '/api/payment/recover':'payment_recovery', '/api/payment/reconcile':'payment_reconciliation',
            '/api/payment/webhook-check':'payment_webhook_verification', '/api/payment/lookup':'payment_lookup',
            '/api/products':'catalogue_read', '/api/recommendations':'recommendations_read',
            '/api/ops/summary':'operations_summary'
          };
          const operation = operations[pathname] || safeRoute;
          if (operations[pathname]) logEvent(operation + (res.statusCode >= 400 ? '_failed' : '_completed'), {operation,method:req.method,status:res.statusCode,outcome:res.statusCode >= 400 ? 'failure' : 'success',reason:res.statusCode >= 400 ? 'see_correlated_request_error' : 'operation_completed'}, res.statusCode >= 400 ? 'WARN' : 'INFO');
          const key = `route="${safeRoute}",status="${res.statusCode}"`;
          counts.set(key, (counts.get(key) || 0) + 1);
          const elapsed = (Date.now() - start) / 1000;
          requests++; duration += elapsed;
          let h = latency.get(safeRoute);
          if (!h) latency.set(safeRoute, h = { buckets: bounds.map(() => 0), sum: 0, count: 0 });
          bounds.forEach((b, i) => { if (elapsed <= b) h.buckets[i]++; }); h.sum += elapsed; h.count++;
          logEvent('request_completed', {method: req.method, route: safeRoute, operation, status: res.statusCode, outcome: res.statusCode >= 400 ? 'failure' : 'success', reason: res.statusCode >= 500 ? 'service_or_dependency_failure' : res.statusCode >= 400 ? 'request_rejected' : 'operation_completed', durationMs: Date.now() - start}, res.statusCode >= 400 ? 'WARN' : probe ? 'DEBUG' : 'INFO');
          exportSpan(service, ctx, start, httpName(req.method, pathname), res.statusCode, ctx.attributes);
        }
      }
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || port), process.env.HOST || '127.0.0.1', () => context.run({service}, () => logEvent('service_listening', {port: Number(process.env.PORT || port)})));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { context.run({service}, () => logEvent('service_stopping')); server.close(() => process.exit(0)); });
  return server;
}
