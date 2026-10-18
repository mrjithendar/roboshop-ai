import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, json, body, text, request, urls, HttpError } from '../shared/runtime.mjs';
import { Store } from './store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const store = new Store(process.env.DATA_DIR || resolve(root, '.data'));
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
const limits = new Map();
function limit(req, ai = false) {
  const key = `${req.socket.remoteAddress}:${ai}`;
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
serve('ai-gateway', 3000, async (req, res, url) => {
  if (url.pathname.startsWith('/api/')) {
    limit(req);
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== publicOrigin) throw new HttpError(403, 'Origin not allowed.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, { assistantMode: process.env.ASSISTANT_AI_ENABLED === 'true' ? 'ai' : 'catalogue-search', checkoutMode: 'demo' });
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
      const data = await body(req);
      if (data.confirmDemo !== true) throw new HttpError(400, 'Confirm that this is a demo order.');
      const order = store.checkout(session(req, res), req.headers['idempotency-key'], await catalogue());
      const { session: _session, key: _key, ...publicOrder } = order;
      return json(res, publicOrder, 201);
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  let path;
  if (['/', '/index.html', '/app.js', '/styles.css'].includes(url.pathname)) path = resolve(root, 'frontend', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  else if (/^\/images\/[a-zA-Z0-9_-]+\.png$/.test(url.pathname)) path = resolve(root, 'legacy/original-robotshop/web/static', url.pathname.slice(1));
  else return;
  try {
    const content = await readFile(path);
    res.writeHead(200, { 'content-type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' }[extname(path)], 'cache-control': extname(path) === '.png' ? 'public, max-age=3600' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
});
