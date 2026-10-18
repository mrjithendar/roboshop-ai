import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../services/frontend/dist/index.html', import.meta.url), 'utf8');
const accountScript = (await readFile(new URL('../services/frontend/dist/account.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const script = accountScript + '\n' + (await readFile(new URL('../services/frontend/dist/app.js', import.meta.url), 'utf8')).replace(/^export \{\};?$/m, '').replace(/^import .*$/gm, '');
const product = { sku: 'TEST', name: '<img src=x onerror=alert(1)>', price: 12, instock: 3, categories: ['robot'], description: 'Test robot', image: '/images/placeholder.png' };
const cart = { items: [{ ...product, quantity: 1, lineTotal: 12 }], subtotal: 12, total: 15, shipping: { address: { recipient: 'Test', line1: 'Test street' }, city: { name: 'Hyderabad', country: 'IN' }, cost: 3, distanceKm: 60, quotedAt: new Date().toISOString() } };
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('UI did not reach expected state');
}
function setup(t, handler = () => undefined) {
  const dom = new JSDOM(html, { url: 'https://shop.example', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async (path, options) => {
    calls.push(path);
    const custom = await handler(path, options);
    const defaults = {
      '/api/products': { products: [product] }, '/api/recommendations': { products: [product] },
      '/api/cart': cart, '/api/payments/config': { enabled: true, message: 'Test payments' },
      '/api/auth/me': { user: { id: 'customer', name: 'Customer', email: 'customer@example.com', role: 'customer' } },
      '/api/settings': { storeName: 'RobotShop', announcement: 'Hello', supportEmail: '', checkoutEnabled: true },
      '/api/status': { assistantMode: 'catalogue-search' }, '/api/payments/current': { order: null },
      '/api/shipping/countries': { countries: [{ code: 'IN', name: 'India', cityCount: 10 }] },
    };
    if (custom) return custom;
    assert.ok(Object.hasOwn(defaults, path), `Unexpected request: ${path}`);
    return { ok: true, status: 200, json: async () => defaults[path] };
  };
  return { w, calls, boot: () => w.eval(`(async () => { ${script}\n })()`), $: selector => w.document.querySelector(selector) };
}

test('compiled storefront renders safe product text and filters the catalogue', async t => {
  const ui = setup(t); await ui.boot();
  assert.equal(ui.$('.product-title').textContent, product.name);
  assert.equal(ui.$('.product-title img'), null);
  ui.$('#search').value = 'not a match';
  ui.$('#search').dispatchEvent(new ui.w.Event('input'));
  assert.match(ui.$('#products').textContent, /No robots match/);
  assert.equal(ui.$('#checkout').disabled, false);
});

test('shipping listeners register before startup requests complete', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const ui = setup(t, async () => { await gate; });
  const boot = ui.boot();
  ui.$('#cart-total').textContent = 'not rendered';
  ui.$('#shipping-form').dispatchEvent(new ui.w.Event('input'));
  assert.notEqual(ui.$('#cart-total').textContent, 'not rendered');
  release(); await boot;
  assert.equal(ui.$('#checkout').disabled, true, 'editing the destination invalidates checkout until requoted');
});

test('expired payment reference recovers the current session without blocking the bag', async t => {
  const ui = setup(t, path => path.includes('/api/payments/status?') ? { ok: false, status: 404, json: async () => ({ error: 'Order not found.' }) } : undefined);
  ui.w.localStorage.setItem('robotshop-payment-order', 'expired');
  await ui.boot(); ui.$('#bag-button').click();
  await waitFor(() => ui.calls.includes('/api/payments/current'));
  assert.equal(ui.w.localStorage.getItem('robotshop-payment-order'), null);
  await waitFor(() => ui.$('#cart-items').children.length === 1);
  assert.match(ui.$('#order-result').textContent, /Order expired is unavailable/);
});

test('failed checkout SDK load is retryable and never creates a payment order', async t => {
  const ui = setup(t); await ui.boot(); ui.$('#checkout').click();
  const first = ui.$('script[src*="checkout.razorpay"]'); assert.ok(first);
  first.dispatchEvent(new ui.w.Event('load')); // SDK global absent despite load event.
  await waitFor(() => ui.$('#order-result').textContent.includes('could not load'));
  assert.equal(ui.$('#checkout').disabled, false);
  ui.$('#checkout').click();
  const second = ui.$('script[src*="checkout.razorpay"]'); assert.ok(second); assert.notEqual(second, first);
  second.dispatchEvent(new ui.w.Event('error'));
  await waitFor(() => !ui.$('#checkout').disabled);
  assert.ok(!ui.calls.includes('/api/payments/orders'));
});

test('temporary payment status failures retain the order reference', async t => {
  const ui = setup(t, path => path.includes('/api/payments/status?') ? { ok: false, status: 503, json: async () => ({ error: 'Payment service unavailable.' }) } : undefined);
  ui.w.localStorage.setItem('robotshop-payment-order', 'pending-order');
  await ui.boot(); ui.$('#bag-button').click();
  await waitFor(() => ui.$('#order-result').textContent.includes('Payment service unavailable'));
  assert.equal(ui.w.localStorage.getItem('robotshop-payment-order'), 'pending-order');
  assert.ok(!ui.calls.includes('/api/payments/current'));
});

test('guest checkout opens login and does not load Razorpay', async t => {
  const ui = setup(t, path => path === '/api/auth/me' ? { ok: true, status: 200, json: async () => ({ user: null }) } : undefined);
  await ui.boot();
  assert.equal(ui.$('#checkout').textContent, 'Log in to checkout');
  ui.$('#checkout').click();
  assert.equal(ui.$('#account-dialog').open, true);
  assert.equal(ui.$('script[src*="checkout.razorpay"]'), null);
  assert.ok(!ui.calls.includes('/api/payments/orders'));
  assert.equal(ui.$('#admin-link').hidden, true);
});
