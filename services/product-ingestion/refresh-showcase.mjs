// Update curated informational content only; never overwrite merchant-edited rows.
import { readFile } from 'node:fs/promises';
import { connectMongo } from './lib/mongo.mjs';
import { normalizeProducts } from './lib/catalogue.mjs';
import { seedProducts } from './lib/products.mjs';
const { client, db } = await connectMongo();
try {
  await seedProducts(db);
  const products=normalizeProducts(JSON.parse(await readFile(new URL('./products.json',import.meta.url),'utf8')));
  let updated=0;
  for(const p of products.filter(p=>p.showcase)) {
    const fields=Object.fromEntries(['specifications','image','imageAttribution','sources','checkedAt','catalogueVersion'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
    const result=await db.collection('products').updateOne({_id:p.sku,showcase:true,revision:1},{$set:fields});
    updated+=result.modifiedCount;
  }
  console.log(`Refreshed ${updated} untouched showcase products; sale products and administrator edits preserved.`);
} finally { await client.close(); }
