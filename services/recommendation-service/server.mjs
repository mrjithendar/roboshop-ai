import { serve, json, request, urls } from './lib/runtime.mjs';
import { rank } from './lib/catalogue.mjs';

serve('recommendation-service', 4102, async (req, res, url) => {
  if (req.method !== 'GET' || url.pathname !== '/api/recommendations') return;
  const { products } = await request(`${urls.catalogue}/api/products`);
  const budget = url.searchParams.has('budget') ? Number(url.searchParams.get('budget')) : undefined;
  const picks = rank(products, { query: url.searchParams.get('q') || '', budget, category: url.searchParams.get('category'), exclude: (url.searchParams.get('exclude') || '').split(','), limit: Number(url.searchParams.get('limit') || 4) });
  json(res, { products: picks, strategy: 'catalogue-keyword-ranking', personalized: false });
});
