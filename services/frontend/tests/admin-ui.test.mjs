import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const html = await readFile(new URL('../dist/admin.html', import.meta.url), 'utf8');
const paths = (await readFile(new URL('../dist/paths.js', import.meta.url), 'utf8')).replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify('https://shop.example/paths.js'));
const script = paths + '\n' + (await readFile(new URL('../dist/admin.js', import.meta.url), 'utf8')).replace(/^export \{\};?$/m, '').replace(/^import .*$/gm, '');
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
      '/api/admin/llm': { config: { provider: 'none' }, revision: 0, status: 'not-configured', endpoints: ['private-ec2'] },
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
  assert.deepEqual(ui.calls.filter(call => !call.path.startsWith('/api/currency/rates')).map(call => call.path), ['/api/auth/me']);
});
test('admin sees safe product editor but no super-admin controls', async t => {
  const ui = setup(t, 'admin'); await ui.boot();
  assert.equal(ui.$('#admin-content').hidden, false);
  assert.equal(ui.$('#tab-users').hidden, true);
  assert.equal(ui.$('#tab-settings').hidden, true);
  assert.equal(ui.$('#tab-llm').hidden, true);
  assert.ok(!ui.calls.some(call => call.path.startsWith('/api/admin/llm')));
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
  assert.equal(ui.$('#tab-users').hidden, false);
  assert.equal(ui.$('#tab-settings').hidden, false);
  assert.equal(ui.$('#tab-llm').hidden, false);
  assert.match(ui.$('#llm-current').textContent, /not-configured/);
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

test('LLM proposed connection test does not activate and disconnect uses revision', async t => {
  const ui = setup(t, 'superadmin'); await ui.boot();
  ui.$('#llm-provider').value = 'ollama'; ui.$('#llm-provider').dispatchEvent(new ui.w.Event('change'));
  assert.equal(ui.$('#llm-region-field').hidden, true);
  assert.equal(ui.$('#llm-endpoint-field').hidden, false);
  ui.$('#llm-model').value = 'qwen3:4b';
  ui.$('#llm-test').click(); await new Promise(resolve => setTimeout(resolve, 10));
  const testCall = ui.calls.find(c => c.path === '/api/admin/llm/test');
  assert.deepEqual(JSON.parse(testCall.options.body), { revision: 0, config: { provider: 'ollama', model: 'qwen3:4b', endpoint: 'private-ec2' } });
  assert.ok(!ui.calls.some(c => c.options.method === 'PUT'));
  assert.match(ui.$('#llm-current').textContent, /none/);
  const original = ui.w.fetch;
  ui.w.fetch = async (path, options) => {
    if (path === '/api/admin/llm/disconnect') {
      ui.calls.push({ path, options });
      return { ok: true, json: async () => ({ config: { provider: 'none' }, revision: 1, status: 'not-configured', endpoints: ['private-ec2'] }) };
    }
    return original(path, options);
  };
  ui.$('#llm-disconnect').click(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(ui.$('#llm-current').textContent, /revision 1/);
  assert.match(ui.$('#llm-status').textContent, /not been stopped or deleted/);
});

test('failed LLM save preserves displayed active revision and shows request ID', async t => {
  const ui = setup(t, 'superadmin'); await ui.boot();
  ui.w.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'Refresh before saving.', requestId: 'test-trace' }) });
  ui.$('#llm-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(ui.$('#llm-current').textContent, /revision 0/);
  assert.match(ui.$('#llm-status').textContent, /test-trace/);
  assert.equal(ui.$('#llm-save').disabled, false);
});

test('failover requires explicit opt-in and submits both configurations with revision', async t => {
  const ui = setup(t, 'superadmin'); await ui.boot();
  assert.equal(ui.$('#llm-failover').checked, false);
  assert.equal(ui.$('#llm-fallback-fields').hidden, true);
  ui.$('#llm-provider').value = 'ollama';
  ui.$('#llm-provider').dispatchEvent(new ui.w.Event('change'));
  assert.equal(ui.$('#llm-fallback-fields').hidden, false);
  assert.match(ui.$('#llm-fallback-fields').textContent, /usage charges/);
  assert.match(ui.$('#llm-fallback-fields').textContent, /catalogue context/);
  ui.$('#llm-model').value = 'qwen3:8b';
  ui.$('#llm-failover').checked = true;
  ui.$('#llm-fallback-region').value = 'us-east-1';
  ui.$('#llm-fallback-model').value = 'model-id';
  const original = ui.w.fetch;
  ui.w.fetch = async (path, options) => {
    if (path === '/api/admin/llm' && options.method === 'PUT') {
      ui.calls.push({ path, options });
      return { ok: true, json: async () => ({ ...JSON.parse(options.body), revision: 1, status: 'configured', verifiedAt: 'now', endpoints: ['private-ec2'] }) };
    }
    return original(path, options);
  };
  ui.$('#llm-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  const save = ui.calls.find(c => c.path === '/api/admin/llm' && c.options.method === 'PUT');
  assert.deepEqual(JSON.parse(save.options.body), { revision: 0, config: { provider: 'ollama', endpoint: 'private-ec2', model: 'qwen3:8b', automaticFailover: true, fallback: { provider: 'bedrock', region: 'us-east-1', model: 'model-id' } } });
  assert.match(ui.$('#llm-status').textContent, /Both providers tested/);
  assert.equal(ui.$('#llm-failover').checked, true);
  ui.$('#llm-failover').checked = false;
  ui.$('#llm-test').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const check = ui.calls.find(c => c.path === '/api/admin/llm/test');
  assert.equal(JSON.parse(check.options.body).config.automaticFailover, undefined);
});

test('tabs switch panels and keyboard navigation skips restricted tabs', async t => {
  const ui = setup(t, 'admin'); await ui.boot();
  assert.equal(ui.$('#panel-products').hidden, false);
  ui.$('#tab-products').dispatchEvent(new ui.w.KeyboardEvent('keydown', {key:'End',bubbles:true}));
  assert.equal(ui.$('#tab-reviews').getAttribute('aria-selected'), 'true');
  assert.equal(ui.$('#panel-products').hidden, true);
  ui.$('#new-product').click();
  assert.equal(ui.$('#panel-editor').hidden, false);
});
test('product image path previews and is included in revision-protected update', async t => {
  const ui = setup(t, 'admin'); await ui.boot(); ui.$('#admin-products button').click();
  ui.$('#product-image').value='/product-media/updated.png';
  ui.$('#product-image').dispatchEvent(new ui.w.Event('input'));
  assert.equal(ui.$('#product-image-preview').hidden,false);
  ui.$('#product-form').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
  await new Promise(r=>setTimeout(r,10));
  const body=JSON.parse(ui.calls.find(c=>c.options.method==='PUT').options.body);
  assert.equal(body.image,'/product-media/updated.png'); assert.equal(body.revision,1);
  assert.equal(ui.$('#panel-products').hidden,false);
});
test('product overview counts stock states and filters the table', async t => {
  const ui = setup(t, 'admin');
  const original = ui.w.fetch;
  const products = [{ ...product, available: 10, instock: 10 }, { ...product, sku: 'LOW', name: 'Low robot', available: 2 }, { ...product, sku: 'OUT', name: 'Gone robot', available: 0 }, { ...product, sku: 'OLD', name: 'Old robot', archived: true }];
  ui.w.fetch = async (path, options) => path === '/api/admin/products' ? { ok: true, json: async () => ({ products }) } : original(path, options);
  await ui.boot();
  assert.deepEqual(['total', 'active', 'low', 'out', 'archived'].map(key => ui.$(`#stat-${key}`).textContent), ['4', '3', '1', '1', '1']);
  assert.match(ui.$('#admin-products').textContent, /Low stock/);
  ui.$('#product-filter').value = 'out'; ui.$('#product-filter').dispatchEvent(new ui.w.Event('change'));
  assert.equal(ui.w.document.querySelectorAll('#admin-products tr').length, 1);
  assert.match(ui.$('#admin-products').textContent, /OUT/);
  ui.$('#product-filter').value = ''; ui.$('#product-search').value = 'nothing here'; ui.$('#product-search').dispatchEvent(new ui.w.Event('input'));
  assert.match(ui.$('#admin-products').textContent, /No products match/);
  assert.match(ui.$('#product-count').textContent, /Showing 0 of 4/);
});
test('leaving the editor with unsaved changes asks before discarding them', async t => {
  const ui = setup(t, 'admin'); await ui.boot();
  ui.$('#admin-products button').click();
  ui.$('#product-name').value = 'Changed'; ui.$('#product-form').dispatchEvent(new ui.w.Event('input'));
  assert.equal(ui.$('#product-dirty').hidden, false);
  ui.w.confirm = () => false; ui.$('#cancel-product').click();
  assert.equal(ui.$('#panel-editor').hidden, false);
  ui.w.confirm = () => true; ui.$('#cancel-product').click();
  assert.equal(ui.$('#panel-products').hidden, false);
});
test('reviews load when the tab first opens and show status badges', async t => {
  const ui = setup(t, 'admin');
  const original = ui.w.fetch;
  ui.w.fetch = async (path, options) => path.startsWith('/api/admin/reviews?') ? (ui.calls.push({ path, options }), { ok: true, json: async () => ({ reviews: [{ id: 'r1', productId: 'TEST', title: 'Great', body: '<b>ok</b>', status: 'pending', synthetic: false }], next: null }) }) : original(path, options);
  await ui.boot();
  ui.$('#tab-reviews').click(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ui.calls.filter(call => call.path.startsWith('/api/admin/reviews?')).length, 1);
  assert.equal(ui.$('#moderation-list b'), null);
  const buttons = [...ui.w.document.querySelectorAll('.admin-review-actions button')];
  assert.equal(buttons.find(button => button.textContent === 'Set pending').disabled, true);
  ui.$('#tab-products').click(); ui.$('#tab-reviews').click(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ui.calls.filter(call => call.path.startsWith('/api/admin/reviews?')).length, 1);
});
test('super admin can search loaded users', async t => {
  const ui = setup(t, 'superadmin'); await ui.boot();
  ui.$('#user-search').value = 'buyer'; ui.$('#user-search').dispatchEvent(new ui.w.Event('input'));
  const rows = [...ui.w.document.querySelectorAll('#admin-users .admin-user')];
  assert.deepEqual(rows.map(row => row.hidden), [true, false]);
  assert.match(ui.$('#user-count').textContent, /Showing 1 of 2/);
});
function respond(ui, routes) {
  const original = ui.w.fetch;
  ui.w.fetch = async (path, options = {}) => {
    for (const [prefix, body] of Object.entries(routes)) if (path.startsWith(prefix)) { ui.calls.push({ path, options }); return { ok: true, status: 200, json: async () => typeof body === 'function' ? body(path, options) : body }; }
    return original(path, options);
  };
}
test('product images are uploaded from a file, not typed as a path', async t => {
  const ui = setup(t, 'admin');
  const uploaded = '/api/product-images/' + 'a'.repeat(32) + '.jpg';
  respond(ui, { '/api/admin/product-images': { image: uploaded } });
  ui.w.createImageBitmap = async () => ({ width: 1200, height: 900, close() {} });
  ui.w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, fillStyle: '' });
  ui.w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  await ui.boot(); ui.$('#new-product').click();
  const picker = ui.$('#product-image-file');
  Object.defineProperty(picker, 'files', { value: [new ui.w.File(['x'], 'robot.png', { type: 'image/png' })] });
  picker.dispatchEvent(new ui.w.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 20));
  const upload = ui.calls.find(call => call.path === '/api/admin/product-images');
  assert.deepEqual(JSON.parse(upload.options.body), { image: 'data:image/jpeg;base64,AAAA' });
  assert.equal(ui.$('#product-image').value, uploaded);
  assert.equal(ui.$('#product-image-preview').hidden, false);
  assert.equal(ui.$('#product-dirty').hidden, false);
  assert.match(ui.$('#product-image-status').textContent, /Image uploaded/);
  ui.$('#product-image-remove').click();
  assert.equal(ui.$('#product-image').value, '');
});
test('unsupported or tiny files are rejected before upload', async t => {
  const ui = setup(t, 'admin');
  ui.w.createImageBitmap = async () => ({ width: 120, height: 90, close() {} });
  await ui.boot(); ui.$('#new-product').click();
  const picker = ui.$('#product-image-file');
  for (const file of [new ui.w.File(['x'], 'vector.svg', { type: 'image/svg+xml' }), new ui.w.File(['x'], 'tiny.png', { type: 'image/png' })]) {
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new ui.w.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.match(ui.$('#product-image-status').textContent, /at least 200/);
  assert.ok(!ui.calls.some(call => call.path === '/api/admin/product-images'));
});
test('standard categories are picked from checkboxes and at least one is required', async t => {
  const ui = setup(t, 'admin'); await ui.boot();
  ui.$('#admin-products button').click();
  assert.equal(ui.$('#product-categories').value, 'Robot');
  ui.$('#category-options input[value="robot arms"]').checked = true;
  ui.$('#product-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(JSON.parse(ui.calls.find(call => call.options.method === 'PUT').options.body).categories, ['robot arms', 'Robot']);
  ui.$('#admin-products button').click();
  ui.$('#category-options input[value="robot arms"]').checked = false; ui.$('#product-categories').value = '';
  const before = ui.calls.length;
  ui.$('#product-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(ui.$('#product-status').textContent, /at least one category/);
  assert.equal(ui.calls.slice(before).filter(call => call.options.method === 'PUT').length, 0);
});
test('fields the server refuses are locked instead of failing on save', async t => {
  const ui = setup(t, 'admin');
  respond(ui, { '/api/admin/products': { products: [{ ...product, showcase: true }], stockEditable: false } });
  await ui.boot(); ui.$('#admin-products button').click();
  assert.equal(ui.$('#product-stock').readOnly, true);
  assert.equal(ui.$('#product-stock-help').hidden, false);
  assert.equal(ui.$('#product-image-file').disabled, true);
  assert.equal(ui.$('#product-price').readOnly, true);
  assert.match(ui.$('#product-image-status').textContent, /provenance/);
  ui.$('#new-product').click();
  assert.equal(ui.$('#product-stock').readOnly, false);
  assert.equal(ui.$('#product-image-file').disabled, false);
});
test('super admin reviews orders and reconciles test orders with a reason and revision', async t => {
  const ui = setup(t, 'superadmin');
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  respond(ui, {
    '/api/admin/overview': { reviews: { pending: 2 }, orders: { needsAttention: 1 } },
    '/api/admin/orders?': { orders: [{ id, status: 'payment_review', paymentMode: 'test', createdAt: '2026-10-01T10:00:00Z', currency: 'INR', total: 1499, items: [{ sku: 'TEST', name: 'Robot', quantity: 2 }], shipping: { recipient: '<b>Asha</b>', city: 'Pune', country: 'IN' } }], total: 1 },
    '/api/admin/test-orders': { orders: [{ id, revision: 4 }] },
    [`/api/admin/test-orders/${id}/reconcile`]: { status: 'paid' },
  });
  await ui.boot(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ui.$('#tab-reviews').textContent, 'Reviews · 2');
  assert.equal(ui.$('#tab-orders').textContent, 'Orders · 1');
  ui.$('#order-mode').value = 'test';
  ui.$('#tab-orders').click(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(ui.$('#admin-orders').textContent, /<b>Asha<\/b>/);
  assert.equal(ui.$('#admin-orders b'), null);
  assert.match(ui.$('#admin-orders').textContent, /2 × Robot/);
  ui.w.prompt = () => 'Provider shows captured payment';
  [...ui.w.document.querySelectorAll('#admin-orders button')].find(button => button.textContent === 'Reconcile').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const call = ui.calls.find(c => c.path.endsWith('/reconcile'));
  assert.deepEqual(JSON.parse(call.options.body), { reason: 'Provider shows captured payment', revision: 4 });
});
test('activity log lists audited changes with readable labels', async t => {
  const ui = setup(t, 'superadmin');
  respond(ui, { '/api/admin/audit?': { entries: [{ at: '2026-10-02T08:30:00Z', action: 'product.update', target: 'TEST', actor: { email: 'ops@example.com', role: 'admin' }, outcome: 'failure', status: 409, fields: ['archived', 'price'], values: { archived: true } }], total: 1 } });
  await ui.boot(); ui.$('#tab-audit').click(); await new Promise(resolve => setTimeout(resolve, 10));
  const text = ui.$('#admin-audit').textContent;
  assert.match(text, /Updated product/); assert.match(text, /ops@example\.com/); assert.match(text, /archived: true, price/); assert.match(text, /Refused \(409\)/);
  assert.equal(ui.$('#more-audit').hidden, true);
});
