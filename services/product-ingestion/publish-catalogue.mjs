// Explicit merchant-authorized replacement: retain historical rows, archive old catalogue.
import { readFile } from 'node:fs/promises';
import { connectMongo } from '../shared/mongo.mjs';
import { normalizeProducts } from '../shared/catalogue.mjs';
const products = normalizeProducts(JSON.parse(await readFile(new URL('./products.json', import.meta.url), 'utf8')));
if (products.length !== 20 || products.some(p => p.currency !== 'USD' || p.price < 100 || p.price > 500 || p.instock < 20 || p.instock > 50 || p.showcase)) throw Error('Invalid merchant catalogue.');
const {client,db} = await connectMongo();
try {
  for (const product of products) {
    // Initial import only: reruns must not replenish sold stock or overwrite admin edits.
    await db.collection('products').updateOne({_id:product.sku},{$setOnInsert:{...product,revision:1}},{upsert:true});
  }
  const retired = await db.collection('products').updateMany({_id:{$nin:products.map(p=>p.sku)},archived:{$ne:true}},{$set:{archived:true},$inc:{revision:1}});
  console.log(`Published 20 USD robot listings; archived ${retired.modifiedCount} previous listings. Existing merchant edits preserved.`);
} finally { await client.close(); }
