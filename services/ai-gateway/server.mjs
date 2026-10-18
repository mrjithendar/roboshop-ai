import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, json, body, text, request, urls, context, HttpError } from '../shared/runtime.mjs';
import { Store } from './store.mjs';
import { OrderPublisher } from './events.mjs';
import { clientAddress } from './proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const store = new Store(process.env.DATA_DIR || resolve(root, '.data'));
const publisher = new OrderPublisher(store, process.env.RABBITMQ_URL);
publisher.start();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void publisher.stop());
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
const limits = new Map();
function limit(req, ai = false) {
  const key = `${clientAddress(req)}:${ai}`;
  const now = Date.now();
  for (const [key, value] of limits) if (value.until < now) limits.delete(key);
  const record = limits.get(key) || { count: 0, until: now + 60000 };
  if (++record.count > (ai ? 10 : 300)) throw new HttpError(429, 'Too many requests. Please wait a minute.');
  limits.set(key, record);
}
function session(req, res) {
  const existing = /(?:^|;\s*)rs_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const id = store.session(existing);
  if (id !== existing) res.setHeader('set-cookie', `rs_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${publicOrigin.startsWith('https:') ? '; Secure' : ''}`);
  return id;
}
async function catalogue() { return (await request(`${urls.catalogue}/api/products`)).products; }
async function paymentCall(path, data) {
  let response;
  const ctx = context.getStore();
  const headers = { 'content-type': 'application/json', 'x-payment-service-token': process.env.PAYMENT_SERVICE_TOKEN || '' };
  if (ctx) headers.traceparent = `00-${ctx.traceId}-${ctx.spanId}-01`;
  try { response = await fetch(`${urls.payment}/api/payment/${path}`, { method: data ? 'POST' : 'GET', headers, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) }); }
  catch { throw new HttpError(503, 'Payment service unavailable. Your bag has been preserved.'); }
  const result = await response.json();
  if (!response.ok) throw new HttpError(response.status, result.error || 'Payment could not be verified.');
  return result;
}
function publicOrder(order) {
  const { session: _session, key: _key, shipmentEvent: _event, ...result } = order;
  return result;
}
function paymentExpectation(order) { return { orderId: order.razorpayOrderId, amount: Math.round(order.total * 100), currency: order.currency }; }
async function reconcile(order) {
  if (order.status !== 'payment_pending') return order;
  const result = await paymentCall('reconcile', paymentExpectation(order));
  return result.verified ? store.markPaid(order.id, result) : order;
}
serve('ai-gateway', 3000, async (req, res, url) => {
  // Provider webhooks have no browser origin. Authenticate exact raw bytes instead.
  if (req.method === 'POST' && url.pathname === '/api/payments/webhook') {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new HttpError(413, 'Webhook too large.'); chunks.push(chunk); }
    const event = await paymentCall('webhook-check', { raw: Buffer.concat(chunks).toString('base64'), signature: req.headers['x-razorpay-signature'] });
    if (!event.ignored) {
      const order = store.state.orders.find(o => o.razorpayOrderId === event.orderId);
      if (order) await reconcile(order);
    }
    return json(res, { received: true });
  }
  if (url.pathname.startsWith('/api/')) {
    limit(req);
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== publicOrigin) throw new HttpError(403, 'Origin not allowed.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
    }
    if (url.pathname.startsWith('/api/shipping/')) {
      const allowed = req.method === 'GET' && ['/api/shipping/countries', '/api/shipping/cities'].includes(url.pathname);
      const quoting = req.method === 'POST' && url.pathname === '/api/shipping/quote';
      if (!allowed && !quoting) return;
      const id = quoting ? session(req, res) : null;
      const data = quoting ? await body(req) : null;
      if (quoting && store.pending(id)) throw new HttpError(409, 'A payment is pending. Shipping cannot be changed.');
      let response;
      const ctx = context.getStore();
      try { response = await fetch(`${urls.shipping}${url.pathname}${url.search}`, { method: req.method, headers: { 'content-type': 'application/json', traceparent: `00-${ctx.traceId}-${ctx.spanId}-01` }, ...(quoting ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(5000) }); }
      catch { throw new HttpError(503, 'Shipping service unavailable. Please try again.'); }
      const result = await response.json();
      if (!response.ok) throw new HttpError(response.status, result.error || 'Shipping could not be calculated.');
      return json(res, quoting ? store.setShipping(id, result, await catalogue()) : result);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, { assistantMode: process.env.ASSISTANT_AI_ENABLED === 'true' ? 'ai' : 'catalogue-search', checkoutMode: 'razorpay' });
    if (req.method === 'GET' && url.pathname === '/api/payments/config') return json(res, await paymentCall('config'));
    if (req.method === 'GET' && url.pathname === '/api/payments/current') {
      const pending = store.pending(session(req, res));
      return json(res, { order: pending ? publicOrder(await reconcile(pending)) : null });
    }
    if (req.method === 'GET' && url.pathname === '/api/payments/status') {
      const order = store.paymentOrder(url.searchParams.get('orderId'), session(req, res));
      return json(res, publicOrder(await reconcile(order)));
    }
    if (req.method === 'POST' && url.pathname === '/api/payments/orders') {
      await body(req);
      const settings = await paymentCall('config');
      if (!settings.enabled) throw new HttpError(503, settings.message);
      const id = session(req, res), products = await catalogue(), previous = store.pending(id);
      let order = store.beginPayment(id, req.headers['idempotency-key'], products);
      if (order.status === 'paid') return json(res, { order: publicOrder(order) });
      if (order.status === 'payment_review' || (previous && order.status === 'creating')) throw new HttpError(409, 'Payment setup needs reconciliation. Contact the store with order ' + order.id + '.');
      if (order.status === 'creating') {
        try { order = store.attachPayment(order.id, await paymentCall('orders', { amount: Math.round(order.total * 100), currency: order.currency, receipt: order.id })); }
        catch (error) { store.reviewPayment(order.id); throw error; }
      }
      return json(res, { order: publicOrder(order), checkout: { key: settings.keyId, order_id: order.razorpayOrderId, amount: Math.round(order.total * 100), currency: order.currency, name: 'RobotShop', description: `Order ${order.id}` }, mode: settings.mode }, 201);
    }
    if (req.method === 'POST' && url.pathname === '/api/payments/verify') {
      const data = await body(req), order = store.paymentOrder(data.orderId, session(req, res));
      if (data.razorpay_order_id !== order.razorpayOrderId) throw new HttpError(400, 'Order ID mismatch.');
      const result = await paymentCall('verify', { ...paymentExpectation(order), paymentId: data.razorpay_payment_id, signature: data.razorpay_signature });
      return json(res, publicOrder(result.verified ? store.markPaid(order.id, result) : order));
    }
    if (req.method === 'GET' && url.pathname === '/api/ready') {
      const result = await request(`${urls.sre}/api/ops`);
      return json(res, result, result.status === 'healthy' ? 200 : 503);
    }
    if (req.method === 'GET' && url.pathname === '/api/products') {
      const products = (await catalogue()).map(p => ({ ...p, instock: store.available(p) }));
      return json(res, { products, currency: 'EUR' });
    }
    if (req.method === 'GET' && url.pathname === '/api/recommendations') {
      const params = new URLSearchParams(url.search);
      const unavailable = (await catalogue()).filter(p => store.available(p) < 1).map(p => p.sku);
      params.set('exclude', [...(params.get('exclude') || '').split(','), ...unavailable].join(','));
      const result = await request(`${urls.recommendations}/api/recommendations?${params}`);
      result.products = result.products.map(p => ({ ...p, instock: store.available(p) })).filter(p => p.instock > 0);
      return json(res, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      limit(req, true);
      const data = await body(req);
      data.message = text(data.message, 'Message');
      const unavailableSkus = (await catalogue()).filter(p => store.available(p) < 1).map(p => p.sku);
      const result = await request(`${urls.agent}/api/chat`, { method: 'POST', body: JSON.stringify({ message: data.message, unavailableSkus }), signal: AbortSignal.timeout(20000) });
      result.products = result.products.map(p => ({ ...p, instock: store.available(p) })).filter(p => p.instock > 0);
      return json(res, result);
    }
    if (req.method === 'GET' && url.pathname === '/api/ops') return json(res, await request(`${urls.sre}/api/ops`));
    if (url.pathname === '/api/cart' && ['GET', 'POST'].includes(req.method)) {
      const id = session(req, res);
      const products = await catalogue();
      if (req.method === 'GET') return json(res, store.cart(id, products));
      const data = await body(req);
      return json(res, store.update(id, data.sku, data.quantity, products));
    }
    if (url.pathname === '/api/orders' && req.method === 'POST') {
      throw new HttpError(410, 'Demo orders are disabled. Use Razorpay checkout.');
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  let path;
  if (['/', '/index.html', '/app.js', '/styles.css'].includes(url.pathname)) path = resolve(root, 'services/frontend/dist', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  else if (/^\/images\/[a-zA-Z0-9_-]+\.png$/.test(url.pathname)) path = resolve(root, 'legacy/original-robotshop/web/static', url.pathname.slice(1));
  else return;
  try {
    const content = await readFile(path);
    res.writeHead(200, { 'content-type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' }[extname(path)], 'cache-control': extname(path) === '.png' ? 'public, max-age=3600' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
});
