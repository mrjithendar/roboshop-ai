import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProducts, rank, budgetFrom } from '../services/recommendation-service/lib/catalogue.mjs';
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

test('merchant collection has 20 priced USD robots with bounded stock and dedicated renders',()=>{
 const rows=normalizeProducts(JSON.parse(readFileSync(new URL('../services/product-ingestion/products.json',import.meta.url))));
 assert.equal(rows.length,20);
 assert.ok(rank(rows,{query:'under 200',budget:200}).length>0);
 for(const p of rows){assert.equal(p.currency,'USD');assert.equal(p.priceType,'sale');assert.equal(p.showcase,false);assert.ok(p.price>=100&&p.price<=500);assert.ok(p.instock>=20&&p.instock<=50);assert.match(p.image,/product-media\/.*\.png$/);assert.ok(readFileSync(new URL('../services/frontend'+p.image,import.meta.url)).length>1000);}
});
