import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { retrieve, answer } from '../services/shopping-agent/agent.mjs';
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const products = read('services/product-ingestion/products.json');
let passed = 0;
for (const item of read('evaluations/rag/cases.json')) {
  const picks = retrieve(products, item.query);
  assert.equal(picks[0]?.sku || null, item.expectedSku, item.query);
  assert.ok(picks.every(p => p.instock > 0 && (item.budget === undefined || p.price <= item.budget)));
  passed++;
}
for (const item of read('evaluations/security/cases.json')) {
  const response = await answer(products, item.query, { apiKey: '', model: '' });
  assert.equal(response.mode, 'catalogue-search');
  assert.ok(response.products.every(p => products.some(source => source.sku === p.sku)));
  assert.ok(!response.answer.includes('<script>'));
  passed++;
}
console.log(`${passed} deterministic retrieval/security evaluations passed. These do not evaluate live-model prompt injection resistance.`);
