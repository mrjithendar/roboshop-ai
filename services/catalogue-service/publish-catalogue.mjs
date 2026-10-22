// Additive, insert-only publication. Never archive, reprice or replenish existing rows.
import { connectMongo } from './lib/mongo.mjs';
import { seedProducts } from './lib/products.mjs';
const { client, db } = await connectMongo();
try {
  await seedProducts(db);
  console.log('Missing configured sale/demo listings inserted. Existing products, admin edits, inventory and order currencies preserved.');
} finally { await client.close(); }
