import { HttpError, json, businessSpan } from './lib/runtime.mjs';
import { rank } from './lib/catalogue.mjs';
import { readProducts } from './lib/products.mjs';

function segment(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw new HttpError(400, 'Invalid URL encoding.'); }
  if (!decoded.trim() || decoded.length > 200 || /[\x00-\x1f\x7f]/.test(decoded)) throw new HttpError(400, 'Invalid catalogue query.');
  return decoded.trim();
}

export function catalogueRoutes(db) {
  return async (req, res, url) => businessSpan(
    url.pathname === "/api/recommendations" ? "catalogue.recommend" : /\/search\//.test(url.pathname) ? "catalogue.search" : "catalogue.read", async () => {
    if (req.method !== 'GET') return;
    if (['/api/catalogue/ready', '/ready'].includes(url.pathname)) {
      try { await db.command({ ping: 1 }); } catch { throw new HttpError(503, 'Catalogue database unavailable.'); }
      return json(res, { status: url.pathname === '/ready' ? 'ready' : 'ok', service: 'catalogue-service' });
    }
    const path = url.pathname;
    const recommendations = path === '/api/recommendations';
    const listing = path === '/api/products' || path === '/products';
    const categories = path === '/categories' || path === '/api/catalogue/categories';
    const product = path.match(/^\/(?:product|api\/catalogue\/product)\/([^/]+)$/);
    const category = path.match(/^\/(?:products|api\/catalogue\/category)\/([^/]+)$/);
    const search = path.match(/^\/(?:search|api\/catalogue\/search)\/([^/]+)$/);
    if (!recommendations && !listing && !categories && !product && !category && !search) return;
    let products;
    try { products = (await readProducts(db)).filter(row => !row.archived); }
    catch { throw new HttpError(503, 'Catalogue database unavailable.'); }
    if (recommendations) {
      const budget = url.searchParams.has('budget') ? Number(url.searchParams.get('budget')) : undefined;
      const picks = rank(products, {
        query: url.searchParams.get('q') || '', budget,
        category: url.searchParams.get('category'),
        exclude: (url.searchParams.get('exclude') || '').split(','),
        limit: Number(url.searchParams.get('limit') || 4),
      });
      return json(res, { products: picks, strategy: 'catalogue-keyword-ranking', personalized: false });
    }
    if (listing) {
      const currencies = [...new Set(products.map(row => row.currency))];
      return json(res, path === '/products' ? products : { products, checkoutCurrency: currencies.length === 1 ? currencies[0] : null, source: 'mongodb' });
    }
    if (categories) return json(res, [...new Set(products.flatMap(row => row.categories))].sort());
    if (product) {
      const sku = segment(product[1]);
      const found = products.find(row => row.sku === sku);
      if (!found) throw new HttpError(404, 'Product not found.');
      return json(res, found);
    }
    if (category) {
      const name = segment(category[1]);
      return json(res, products.filter(row => row.categories.includes(name)).sort((a,b) => a.name.localeCompare(b.name)));
    }
    const terms = segment(search[1]).toLowerCase().split(/\s+/);
    // Literal matching: never pass user text as Mongo operators or executable regex.
    return json(res, products.filter(row => terms.every(term => `${row.name} ${row.manufacturer || ''} ${row.model || ''} ${row.compatibility?.join(' ') || ''} ${Object.values(row.specifications || {}).join(' ')} ${row.description} ${row.categories.join(' ')}`.toLowerCase().includes(term))));
  });
}
