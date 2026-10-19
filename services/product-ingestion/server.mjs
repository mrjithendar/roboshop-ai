import { serve, json } from './lib/runtime.mjs';
import { connectMongo } from './lib/mongo.mjs';
import { seedProducts, readProducts } from './lib/products.mjs';
const { db } = await connectMongo();
await seedProducts(db);
serve('product-ingestion', 4101, async (req, res, url) => {
  if (req.method === 'GET' && url.pathname === '/api/products') return json(res, { products: await readProducts(db), checkoutCurrency: 'EUR', source: 'mongodb' });
  if (req.method === 'GET' && url.pathname === '/api/catalogue/ready') { await db.command({ ping: 1 }); return json(res, { status: 'ok' }); }
});
