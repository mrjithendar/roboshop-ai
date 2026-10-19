import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { normalizeProducts } from '../services/shared/catalogue.mjs';
const products = normalizeProducts(JSON.parse(await readFile('services/product-ingestion/products.json', 'utf8')));
const html = await readFile('services/frontend/dist/product.html', 'utf8');
const script = (await readFile('services/frontend/dist/account.js', 'utf8')).replace(/^export /gm, '') + '\n' + (await readFile('services/frontend/dist/product.js', 'utf8')).replace(/^import .*$/gm, '').replace(/^export \{\};?$/m, '');
async function setup(t, missing = false) {
  const p = products[0], calls = [];
  const dom = new JSDOM(html, { url: `https://shop.example/products/${p.slug}`, runScripts: 'outside-only' }); t.after(() => dom.window.close());
  dom.window.fetch = async (path, options) => {
    calls.push({ path, options });
    const defaults = { '/api/auth/me': { user: null }, [`/api/products/${p.slug}`]: { product: p, related: [products[1]] } };
    if (path.includes('/reviews?')) { const demo = path.includes('kind=demo'); return { ok: true, json: async () => ({ reviews: [{ id: 'r', title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>', author: 'Customer', createdAt: '2026-10-19', rating: 4, synthetic: demo, verifiedPurchase: false }], summary: { count: 1, average: 4 }, next: null }) }; }
    return { ok: !missing || path === '/api/auth/me', json: async () => missing && path !== '/api/auth/me' ? { error: 'Product not found.' } : defaults[path] };
  };
  await dom.window.eval(`(async()=>{${script}})()`);
  return { document: dom.window.document, window: dom.window, calls, p };
}
test('curated metadata survives normalization without changing currency or source URLs', () => {
  assert.equal(products.length, 30); assert.ok(products.every(p => p.slug && p.showcase && p.sources.length && p.image === '/images/placeholder.png'));
  const usd = products.find(p => p.sku === 'POL-3575'); assert.equal(usd.currency, 'USD'); assert.equal(usd.price, 94.95); assert.equal(usd.priceType, 'reference');
});
test('shareable product page renders safe source-backed details and no showcase cart button', async t => {
  const ui = await setup(t);
  assert.match(ui.document.title, /Pololu/); assert.equal(ui.document.querySelector('h1').textContent, ui.p.name);
  assert.match(ui.document.body.textContent, /Price on request/); assert.match(ui.document.body.textContent, /simulated/);
  assert.match(ui.document.body.textContent, /Demo reviews and purchase activity are synthetic/);
  assert.equal(ui.document.querySelector('#review-list script'), null); assert.equal(ui.document.querySelector('#review-list img'), null);
  assert.ok(ui.document.querySelector('#related-products a').href.includes('/products/'));
  assert.ok(![...ui.document.querySelectorAll('button')].some(b => b.textContent === 'Add to bag'));
  assert.ok(!ui.calls.some(c => c.path.includes('payments')));
});
test('missing product shows recovery state and meaningful title', async t => {
  const ui = await setup(t, true); assert.equal(ui.document.title, 'Product unavailable · RobotShop'); assert.match(ui.document.querySelector('#product-status').textContent, /not found/); assert.equal(ui.document.querySelector('#reviews-section').hidden, true);
});
test('synthetic reviews are separately selected and individually labelled', async t => {
  const ui = await setup(t); const select = ui.document.querySelector('#review-kind'); select.value = 'demo'; select.dispatchEvent(new ui.window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 20)); assert.match(ui.document.querySelector('#review-list').textContent, /SYNTHETIC DEMO REVIEW/); assert.match(ui.document.querySelector('#rating-summary').textContent, /Synthetic demo ratings/);
});
