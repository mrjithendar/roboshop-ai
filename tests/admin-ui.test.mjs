import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const html = await readFile(new URL('../services/frontend/dist/admin.html', import.meta.url), 'utf8');
const script = (await readFile(new URL('../services/frontend/dist/admin.js', import.meta.url), 'utf8')).replace(/^export \{\};?$/m, '');
const product = { sku: 'TEST', name: '<img src=x onerror=alert(1)>', price: 20, instock: 5, available: 3, categories: ['Robot'], description: 'Robot', archived: false, revision: 1 };
function setup(t, role) {
  const dom = new JSDOM(html, { url: 'https://shop.example/admin', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const calls = [], w = dom.window;
  w.fetch = async (path, options) => {
    calls.push({ path, options });
    const defaults = {
      '/api/auth/me': { user: { id: 'root', name: 'Operator', email: 'operator@example.com', role } },
      '/api/admin/products': { products: [product] },
      '/api/admin/users': { users: [{ id: 'root', name: 'Operator', email: 'operator@example.com', role: 'superadmin' }, { id: 'customer', name: 'Buyer', email: 'buyer@example.com', role: 'customer', disabled: false }], next: null },
      '/api/admin/settings': { storeName: 'Test shop', announcement: 'Welcome', supportEmail: 'support@example.com', checkoutEnabled: true },
    };
    return { ok: true, status: 200, json: async () => defaults[path] || { saved: true } };
  };
  return { calls, w, $: selector => w.document.querySelector(selector), boot: () => w.eval(`(async () => { ${script}\n })()`) };
}
test('customer cannot open the admin interface or trigger privileged reads', async t => {
  const ui = setup(t, 'customer'); await ui.boot();
  assert.equal(ui.$('#admin-content').hidden, true);
  assert.equal(ui.$('#admin-login').hidden, false);
  assert.equal(ui.calls.length, 1);
});
test('admin sees safe product editor but no super-admin controls', async t => {
  const ui = setup(t, 'admin'); await ui.boot();
  assert.equal(ui.$('#admin-content').hidden, false);
  assert.equal(ui.$('#users-section').hidden, true);
  assert.equal(ui.$('#settings-section').hidden, true);
  assert.equal(ui.$('#admin-products img'), null);
  ui.$('#admin-products button').click();
  assert.equal(ui.$('#product-sku').readOnly, true);
  assert.equal(ui.$('#product-price').value, '20');
  ui.$('#product-price').value = '25';
  ui.$('#product-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  const save = ui.calls.find(call => call.options.method === 'PUT');
  assert.equal(save.path, '/api/admin/products/TEST');
  assert.deepEqual(JSON.parse(save.options.body).revision, 1);
  assert.equal(JSON.parse(save.options.body).price, 25);
  assert.ok(!ui.calls.some(call => call.path === '/api/admin/users'));
});
test('super admin sees user access controls and bounded store configuration', async t => {
  const ui = setup(t, 'superadmin'); await ui.boot();
  assert.equal(ui.$('#users-section').hidden, false);
  assert.equal(ui.$('#settings-section').hidden, false);
  assert.equal(ui.$('#setting-name').value, 'Test shop');
  assert.match(ui.$('#admin-users').firstElementChild.textContent, /protected/);
  assert.equal(ui.$('#admin-users').firstElementChild.querySelector('select'), null);
  const role = ui.$('#admin-users select'); role.value = 'admin';
  [...ui.w.document.querySelectorAll('#admin-users button')].find(button => button.textContent === 'Save access').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const update = ui.calls.find(call => call.options.method === 'PATCH');
  assert.equal(update.path, '/api/admin/users/customer');
  assert.deepEqual(JSON.parse(update.options.body), { role: 'admin', disabled: false });
});

test('super-admin customer details are fetched only on explicit inspection', async t => {
  const ui = setup(t, 'superadmin'); await ui.boot();
  assert.ok(!ui.calls.some(call => call.path.endsWith('/profile')));
  const original = ui.w.fetch;
  ui.w.fetch = async (path, options) => {
    if (path.endsWith('/profile')) { ui.calls.push({ path, options }); return { ok: true, json: async () => ({ activity: { lastLoginIp: '192.0.2.1', loginCount: 2 }, addresses: [] }) }; }
    if (path.endsWith('/purchases')) { ui.calls.push({ path, options }); return { ok: true, json: async () => ({ purchases: [], next: null }) }; }
    return original(path, options);
  };
  [...ui.w.document.querySelectorAll('#admin-users button')].find(button => button.textContent === 'Customer details').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(ui.$('.customer-details').textContent, /192\.0\.2\.1/);
  assert.equal(ui.$('.customer-details').hidden, false);
});
