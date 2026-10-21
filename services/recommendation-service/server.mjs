import { serve, json, request, urls } from './lib/runtime.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rank } from './lib/catalogue.mjs';

export async function handle(req, res, url, check = request) {
  if (req.method === 'GET' && url.pathname === '/ready') {
    try { await check(`${urls.catalogue}/api/catalogue/ready`, { signal: AbortSignal.timeout(1000) }); return json(res, { status: 'ready' }); }
    catch { return json(res, { status: 'unavailable', dependency: 'catalogue' }, 503); }
  }
  if (req.method !== 'GET' || url.pathname !== '/api/recommendations') return;
  const { products } = await check(`${urls.catalogue}/api/products`);
  const budget = url.searchParams.has('budget') ? Number(url.searchParams.get('budget')) : undefined;
  const picks = rank(products, { query: url.searchParams.get('q') || '', budget, category: url.searchParams.get('category'), exclude: (url.searchParams.get('exclude') || '').split(','), limit: Number(url.searchParams.get('limit') || 4) });
  json(res, { products: picks, strategy: 'catalogue-keyword-ranking', personalized: false });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve('recommendation-service', 4102, handle);
