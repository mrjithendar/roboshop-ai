// Explicit migration: preserves all administrator-edited legacy rows and all orders.
import { readFile } from 'node:fs/promises';
import { connectMongo } from '../shared/mongo.mjs';
import { seedProducts } from '../shared/products.mjs';
if (!process.argv.includes('--archive-legacy')) throw new Error('Pass --archive-legacy to archive only unchanged fictional seed products.');
const { client, db } = await connectMongo();
try {
  const old = JSON.parse(await readFile(new URL('./legacy-products.json', import.meta.url), 'utf8'));
  let count = 0;
  for (const p of old) {
    const { modifiedCount } = await db.collection('products').updateOne({ _id: p.sku, revision: 1, name: p.name, description: p.description, price: p.price, instock: p.instock }, { $set: { archived: true }, $inc: { revision: 1 } });
    count += modifiedCount;
  }
  await seedProducts(db);
  console.log(`Archived ${count} unchanged fictional seed rows; curated products inserted if absent. Administrator edits preserved.`);
} finally { await client.close(); }
