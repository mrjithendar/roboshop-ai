import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProducts, rank, budgetFrom } from '../services/shared/catalogue.mjs';
import { answer } from '../services/shopping-agent/agent.mjs';
const products = normalizeProducts(JSON.parse(readFileSync(new URL('../services/product-ingestion/products.json', import.meta.url))));

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
test('offline assistant is explicit and makes no network requests', async () => {
  const result = await answer(products, 'security under 1000', { apiKey: '', model: '', fetcher: () => assert.fail('Must not call model') });
  assert.equal(result.mode, 'catalogue-search'); assert.equal(result.products[0].sku, 'RED');
});
test('model integration uses grounded evidence, disables storage and extracts output', async () => {
  const result = await answer(products, 'security under 1000', { apiKey: 'test-key', model: 'test-model', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false); assert.equal(payload.model, 'test-model'); assert.equal(JSON.parse(payload.input).catalogueEvidence[0].sku, 'RED');
    assert.equal(payload.tools, undefined);
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'RED matches the security request.' }] }], usage: { input_tokens: 20, output_tokens: 10 } }) };
  } });
  assert.equal(result.mode, 'ai'); assert.equal(result.answer, 'RED matches the security request.');
});
test('failed model requests visibly fall back without leaking errors', async () => {
  const result = await answer(products, 'mining', { apiKey: 'secret', model: 'test', fetcher: async () => { throw new Error('secret'); } });
  assert.equal(result.mode, 'catalogue-search'); assert.match(result.notice, /unavailable/); assert.ok(!JSON.stringify(result).includes('secret'));
});
