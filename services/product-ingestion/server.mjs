import { readFileSync } from 'node:fs';
import { serve, json } from '../shared/runtime.mjs';
import { normalizeProducts } from '../shared/catalogue.mjs';

const file = process.env.CATALOGUE_FILE || new URL('./products.json', import.meta.url);
const products = normalizeProducts(JSON.parse(readFileSync(file, 'utf8')));
serve('product-ingestion', 4101, async (req, res, url) => {
  if (req.method === 'GET' && url.pathname === '/api/products') json(res, { products, currency: 'EUR', source: 'legacy-catalogue-snapshot' });
});
