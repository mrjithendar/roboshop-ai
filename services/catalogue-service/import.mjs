// Import a validated products JSON file into MongoDB (insert-only; existing SKUs untouched).
// The standard catalogue is services/mongodb/catalog.js; use this for one-off additions.
import { resolve } from 'node:path';
import { connectMongo } from './lib/mongo.mjs';
import { seedProducts } from './lib/products.mjs';

const [source] = process.argv.slice(2);
if (!source) {
  console.error('Usage: npm run ingest -- products.json   (needs MONGODB_URL; existing products are never changed)');
  process.exit(1);
}
const { client, db } = await connectMongo();
try {
  const { inserted, total } = await seedProducts(db, resolve(source));
  console.log(`Imported ${inserted} of ${total} validated products into MongoDB; existing products unchanged.`);
} finally { await client.close(); }
