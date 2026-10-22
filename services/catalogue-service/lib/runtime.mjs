import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const context = new AsyncLocalStorage();

let logService = process.env.OTEL_SERVICE_NAME || 'roboshop';
const logFields = new Set('method route status durationMs dependency operation errorType errorCode provider reason revision port state'.split(' '));
export function logEvent(event, fields = {}, level = 'INFO') {
  const levels = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
  if ((levels[level] || 20) < (levels[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] || 20)) return;
  const ctx = context.getStore();
  const safe = Object.fromEntries(Object.entries(fields).filter(([k, v]) => logFields.has(k) && ['string','number','boolean'].includes(typeof v)));
  try { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: ctx?.service || logService, event, ...(ctx?.traceId ? {traceId: ctx.traceId} : {}), ...safe })); }
  catch { /* Logging must not change the request outcome. */ }
}

export const urls = {
  ...(process.env.CART_URL ? { cart: process.env.CART_URL } : {}),
  catalogue: process.env.CATALOGUE_URL || process.env.INGESTION_URL || 'http://127.0.0.1:4108',
  recommendations: process.env.RECOMMENDATION_URL || 'http://127.0.0.1:4102',
  agent: process.env.AGENT_URL || 'http://127.0.0.1:4103',
  sre: process.env.SRE_URL || 'http://127.0.0.1:4104',
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
export async function clientSpan(name, work, attributes = {}) {
  const parent = context.getStore();
  const ctx = { traceId: parent?.traceId || randomBytes(16).toString('hex'), spanId: randomBytes(8).toString('hex'), parentSpanId: parent?.spanId, flags: parent?.flags || '01', service: parent?.service || process.env.OTEL_SERVICE_NAME || 'roboshop', kind: 3, attributes: {} };
  const start = Date.now(); let status = 200;
  return context.run(ctx, async () => {
    try { const result = await work(ctx); if (typeof result?.ok === "boolean" && Number.isInteger(result.status)) status = result.status; return result; }
    catch (error) { status = error.status || 503; throw error; }
    finally {
      logEvent('dependency_call_completed', {operation: name, dependency: attributes['server.address'], status, durationMs: Date.now()-start}, status >= 400 ? 'WARN' : 'INFO');
      exportSpan(ctx.service, ctx, start, name, status, attributes);
    }
  });
}
export async function request(url, options = {}) {
  return clientSpan(`HTTP ${options.method || 'GET'}`, async ctx => {
    const headers = { 'content-type': 'application/json', ...options.headers, traceparent: `00-${ctx.traceId}-${ctx.spanId}-${ctx.flags}` };
    try {
      const response = await fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(12000) });
      if (!response.ok) { logEvent('dependency_response_rejected', {dependency: new URL(url).hostname, status: response.status}, 'WARN'); throw new HttpError(502, 'A dependent service is unavailable.'); }
      return await response.json();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(503, 'A dependent service is unavailable. Please try again.');
    }
  }, { 'server.address': new URL(url).hostname, 'http.request.method': options.method || 'GET' });
}
let pendingExports = 0;
export function exportSpan(service, ctx, start, name, status, attributes = {}) {
  if (process.env.OTEL_SDK_DISABLED === 'true' || ctx.flags === '00') return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const lf = process.env.LANGFUSE_BASE_URL;
  const targets = [];
  if (endpoint) targets.push([endpoint, {}]);
  if (service === 'shopping-agent' && lf && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    targets.push([`${lf.replace(/\/$/, '')}/api/public/otel/v1/traces`, {
      Authorization: `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString('base64')}`,
      'x-langfuse-ingestion-version': '4',
    }]);
  }
  if (!targets.length || pendingExports >= 32) return;
  const payload = { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }, { key: 'service.version', value: { stringValue: process.env.OTEL_SERVICE_VERSION || '0.2.0' } }, { key: 'deployment.environment.name', value: { stringValue: process.env.DEPLOYMENT_ENVIRONMENT || 'development' } }] }, scopeSpans: [{ scope: { name: 'roboshop.manual', version: '0.1.0' }, spans: [{
    traceId: ctx.traceId, spanId: ctx.spanId, ...(ctx.parentSpanId ? { parentSpanId: ctx.parentSpanId } : {}), name, kind: ctx.kind || 2, flags: 1,
    startTimeUnixNano: String(BigInt(start) * 1000000n), endTimeUnixNano: String(BigInt(Date.now()) * 1000000n),
    status: { code: status >= 500 ? 2 : 1 },
    attributes: Object.entries({ 'http.response.status_code': status, ...attributes }).map(([key, value]) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: String(value) } })),
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
  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    let incoming = /^00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])$/.exec(req.headers.traceparent || '');
    if (incoming && (/^0+$/.test(incoming[1]) || /^0+$/.test(incoming[2]))) incoming = null;
    const ctx = { traceId: incoming?.[1] || randomBytes(16).toString('hex'), spanId: randomBytes(8).toString('hex'), parentSpanId: incoming?.[2], flags: incoming?.[3] || '01', service, attributes: {} };
    res.setHeader('x-request-id', ctx.traceId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' https://*.razorpay.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    await context.run(ctx, async () => {
      let route = 'unknown', probe = false;
      try {
        const url = new URL(req.url, 'http://localhost');
        probe = url.pathname.endsWith('/ready');
        route = url.pathname.startsWith('/api/') ? url.pathname.split('/').slice(0, 3).join('/') : ['/health', '/metrics'].includes(url.pathname) ? url.pathname : 'static';
        if (url.pathname === '/health' && req.method === 'GET') return json(res, { status: 'ok', service });
        if (url.pathname === '/metrics' && req.method === 'GET') {
          const rows = ['# TYPE roboshop_http_requests_total counter'];
          for (const [labels, count] of counts) rows.push(`roboshop_http_requests_total{service="${service}",${labels}} ${count}`);
          rows.push('# TYPE roboshop_http_duration_seconds summary', `roboshop_http_duration_seconds_sum{service="${service}"} ${duration}`, `roboshop_http_duration_seconds_count{service="${service}"} ${requests}`, '');
          res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
          return res.end(rows.join('\n'));
        }
        await handler(req, res, url);
        if (!res.writableEnded) json(res, { error: 'Not found.' }, 404);
      } catch (e) {
        logEvent('request_failed', {method: req.method, status: e.status || 500, errorType: e.constructor?.name || 'Error'}, e.status && e.status < 500 ? 'WARN' : 'ERROR');
        if (!res.headersSent) json(res, { error: e.status ? e.message : 'Internal service error.', requestId: ctx.traceId }, e.status || 500);
        else res.end();
      } finally {
        if (!['/health', '/metrics'].includes(route)) {
          // Route labels deliberately omit query strings, SKUs, cookies and prompts.
          const safeRoute = ['/api/auth', '/api/admin', '/api/settings', '/api/catalogue', '/api/products', '/api/recommendations', '/api/chat', '/api/cart', '/api/orders', '/api/payment', '/api/payments', '/api/shipping', '/api/ops', '/api/status', '/api/ready'].includes(route) ? route : 'other';
          const key = `route="${safeRoute}",status="${res.statusCode}"`;
          counts.set(key, (counts.get(key) || 0) + 1);
          requests++; duration += (Date.now() - start) / 1000;
          logEvent('request_completed', {method: req.method, route: safeRoute, status: res.statusCode, durationMs: Date.now() - start}, res.statusCode >= 400 ? 'WARN' : probe ? 'DEBUG' : 'INFO');
          exportSpan(service, ctx, start, `${req.method} ${safeRoute}`, res.statusCode, ctx.attributes);
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
