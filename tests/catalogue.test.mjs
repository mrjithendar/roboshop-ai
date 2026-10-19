import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProducts, rank, budgetFrom } from '../services/shared/catalogue.mjs';
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
