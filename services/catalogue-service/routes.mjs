import { HttpError, json } from './lib/runtime.mjs';
import { readProducts } from './lib/products.mjs';

function segment(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw new HttpError(400, 'Invalid URL encoding.'); }
  if (!decoded.trim() || decoded.length > 200 || /[\x00-\x1f\x7f]/.test(decoded)) throw new HttpError(400, 'Invalid catalogue query.');
  return decoded.trim();
}

export function catalogueRoutes(db) {
  return async (req, res, url) => {
    if (req.method !== 'GET') return;
    if (url.pathname === '/api/catalogue/ready') {
      try { await db.command({ ping: 1 }); } catch { throw new HttpError(503, 'Catalogue database unavailable.'); }
      return json(res, { status: 'ok', service: 'catalogue-service' });
    }
    const path = url.pathname;
    const listing = path === '/api/products' || path === '/products';
    const categories = path === '/categories' || path === '/api/catalogue/categories';
    const product = path.match(/^\/(?:product|api\/catalogue\/product)\/([^/]+)$/);
    const category = path.match(/^\/(?:products|api\/catalogue\/category)\/([^/]+)$/);
    const search = path.match(/^\/(?:search|api\/catalogue\/search)\/([^/]+)$/);
    if (!listing && !categories && !product && !category && !search) return;
    let products;
    try { products = (await readProducts(db)).filter(row => !row.archived); }
    catch { throw new HttpError(503, 'Catalogue database unavailable.'); }
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
  };
}
