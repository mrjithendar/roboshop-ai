import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProducts, rank, budgetFrom } from '../services/catalogue-service/lib/catalogue.mjs';
import { plan } from '../scripts/data/import-catalog.mjs';
const products = normalizeProducts(JSON.parse(readFileSync(new URL('../tests/fixtures/catalogue/fictional-products.json', import.meta.url))));

test('retrieval respects budget, availability, relevance and exclusions', () => {
  assert.equal(budgetFrom('security under €1,000'), 1000);
  assert.equal(rank(products, { query: 'security', budget: 1000 })[0].sku, 'RED');
  assert.deepEqual(rank(products, { query: 'security', budget: 1000, exclude: ['RED'] }), []);
  assert.deepEqual(rank(products, { query: 'security', budget: 5 }), []);
  assert.ok(rank(products, { query: '' }).every(p => p.instock > 0));
  assert.equal(rank(products, { query: 'mining' })[0].sku, 'RMC');
  assert.deepEqual(rank(products, { query: 'waterproof submarine' }), []);
});
test('ingestion rejects malformed and duplicate products', () => {
  for (const field of [{ price: -1 }, { instock: 1.5 }, { sku: '__proto__' }, { sku: '../../x' }, { categories: null }]) assert.throws(() => normalizeProducts([{ ...products[0], ...field }]));
  assert.throws(() => normalizeProducts([products[0], products[0]]));
  assert.throws(() => rank(products, { budget: NaN }));
});

test('demo collection has 32 priced INR robots with bounded stock and renders or labelled illustrations',()=>{
 const rows=normalizeProducts(plan().products);
 assert.equal(rows.length,32);
 assert.ok(rank(rows,{query:'under 200',budget:200}).length>0);
 for(const p of rows){assert.equal(p.currency,'INR');assert.equal(p.priceType,'sale');assert.equal(p.showcase,false);assert.equal(p.demo,true);assert.equal(p.fulfilment,'simulated');assert.ok(p.price>=99&&p.price<=999);assert.ok(p.instock>=20&&p.instock<=50);if(p.image==='/images/placeholder.png')assert.equal(p.productType,'complete robot');else{assert.match(p.image,/product-media\/.*\.png$/);assert.ok(readFileSync(new URL('../services/web/frontend'+p.image,import.meta.url)).length>1000);}}
});

test('old concept catalogue retains demo classification after normalization', () => {
  const row = {...products[0], catalogueVersion:'merchant-20-inr-v1', demo:false, fulfilment:'merchant'};
  const [normalized] = normalizeProducts([row]);
  assert.equal(normalized.demo,true); assert.equal(normalized.fulfilment,'simulated');
});
