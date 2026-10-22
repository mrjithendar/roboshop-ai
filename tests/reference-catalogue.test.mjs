import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seedProducts } from '../services/catalogue-service/lib/products.mjs';
const source = JSON.parse(readFileSync(new URL('../services/catalogue-service/reference-products.json', import.meta.url)));
for (const service of ['catalogue-service']) {
 const {normalizeProducts,rank} = await import(`../services/${service}/lib/catalogue.mjs`);
 test(`${service}: sourced collection survives normalization without sale or availability claims`,()=>{
  const rows=normalizeProducts(source);
  assert.equal(rows.length,20);
  assert.equal(new Set(rows.map(p=>p.sku)).size,20);
  for(const p of rows) {
   assert.equal(p.collection,'reference');assert.equal(p.priceType,'reference');assert.equal(p.currency,'USD');assert.equal(p.instock,0);assert.equal(p.fulfilment,'simulated');
   assert.ok(p.priceSourceUrl.startsWith('https://www.pololu.com/product/'));assert.ok(p.sources.some(s=>s.url===p.priceSourceUrl));assert.ok(p.compatibility.length);assert.ok(p.unresolvedFields.length);assert.ok(p.priceCheckedAt);
   assert.equal(p.image,'/images/placeholder.png');assert.ok(Object.keys(p.specifications).length);
  }
  assert.ok(rank(rows,{query:'RP2040'}).length);
  assert.ok(rank(rows,{query:'under $200',budget:200}).every(p=>p.price<=200));
  assert.deepEqual(rank(rows,{query:'under ₹999',budget:999}),[]);
 });
 test(`${service}: rejects incomplete provenance or reference-to-sale conversions`,()=>{
  for(const change of [{priceType:'sale'},{collection:'merchant'},{showcase:false},{instock:20},{fulfilment:'merchant'},{priceCheckedAt:'unknown'},{sources:[]},{priceSourceUrl:'javascript:alert(1)'},{price:-1},{image:'/product-media/copied.png'}]) assert.throws(()=>normalizeProducts([{...source[0],...change}]));
  const [unknown]=normalizeProducts([{...source[0],price:0,priceType:'on-request'}]);
  assert.deepEqual(rank([unknown],{query:'under $200',budget:200}),[]);
 });
}
test('repeat publication preserves admin edits, archived rows and unrelated merchant prices',async()=>{
 const rows=new Map();const merchant={_id:'SHOP',price:2000,currency:'JPY',instock:6,revision:5};rows.set('SHOP',structuredClone(merchant));
 const db={collection(name){assert.equal(name,'products');return {createIndex:async()=>{},bulkWrite:async ops=>{for(const {updateOne:o} of ops){assert.deepEqual(Object.keys(o.update),['$setOnInsert']);assert.equal(o.upsert,true);if(!rows.has(o.filter._id))rows.set(o.filter._id,{_id:o.filter._id,...structuredClone(o.update.$setOnInsert)});}}};}};
 await seedProducts(db);assert.equal(rows.size,21);
 assert.equal(rows.has(source[0].sku),false);
 const row=[...rows.values()].find(p=>p._id!=='SHOP');Object.assign(row,{name:'Admin title',archived:true,revision:9});
 await seedProducts(db);assert.equal(rows.size,21);assert.equal(row.name,'Admin title');assert.equal(row.archived,true);assert.equal(row.revision,9);assert.deepEqual(rows.get('SHOP'),merchant);
 const publisher=readFileSync(new URL('../services/catalogue-service/publish-catalogue.mjs',import.meta.url),'utf8');assert.doesNotMatch(publisher,/repriceCatalogue|updateMany/);
});

for (const service of ['catalogue-service']) {
 test(`${service}: removes reference listings from public reads without deleting stored data`, async () => {
  const {readProducts}=await import(`../services/${service}/lib/products.mjs`);
  const demo=JSON.parse(readFileSync(new URL('../services/catalogue-service/products.json',import.meta.url),'utf8'));
  const rows=[...demo,...source];
  const db={collection(){return {find(){return {sort(){return {limit(){return {toArray:async()=>rows};}};}};}};}};
  const products=await readProducts(db);
  assert.equal(products.length,demo.length);
  assert.ok(products.every(p=>!p.showcase && p.collection!=='reference'));
  assert.equal(rows.length,demo.length+source.length);
 });
}
