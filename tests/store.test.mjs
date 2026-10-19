import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './fixtures/previous-gateway/store.mjs';
const products = [{ sku: 'TEST', name: 'Test', price: 12.34, instock: 2 }];

test('cart isolation, persistence, authoritative totals and idempotent checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'robotshop-store-'));
  try {
    const store = new Store(dir), alice = store.session(), bob = store.session();
    assert.throws(() => store.update(alice, 'TEST', -1, products));
    assert.throws(() => store.update(alice, 'TEST', 3, products));
    assert.throws(() => store.update(alice, 'MISSING', 1, products));
    store.update(alice, 'TEST', 2, products); store.update(bob, 'TEST', 1, products);
    assert.equal(store.cart(alice, products).total, 24.68);
    assert.equal(store.cart(bob, products).total, 12.34);
    assert.throws(() => store.beginPayment(alice, 'idempotency-key-0001', products), /delivery address/);
    store.setShipping(alice, { cost: 3, quotedAt: new Date().toISOString(), city: { id: 1 } }, products);
    const order = store.beginPayment(alice, 'idempotency-key-0001', products);
    assert.equal(order.total, 27.68);
    assert.throws(() => store.setShipping(alice, { cost: 0 }, products), /pending/);
    assert.equal(order.paymentCaptured, false);
    assert.equal(store.beginPayment(alice, 'idempotency-key-0001', products).id, order.id);
    assert.equal(store.cart(alice, products).items.length, 1);
    assert.throws(() => store.update(alice, 'TEST', 0, products), /pending/);
    assert.throws(() => store.beginPayment(bob, 'idempotency-key-0002', products), /Stock changed/);
    store.attachPayment(order.id, { orderId: 'order_TEST', amount: 2768, currency: 'EUR' });
    assert.throws(() => store.markPaid(order.id, { verified: false }), /mismatch/);
    const verified = { verified: true, orderId: 'order_TEST', paymentId: 'pay_TEST', amount: 2768, currency: 'EUR' };
    assert.equal(store.markPaid(order.id, verified).status, 'paid');
    assert.equal(store.markPaid(order.id, verified).id, order.id);
    const restored = new Store(dir);
    assert.equal(restored.available(products[0]), 0);
    assert.equal(restored.cart(alice, products).items.length, 0);
    assert.equal(restored.state.orders.length, 1);
    assert.equal(restored.pendingEvents().length, 1);
    const event = restored.pendingEvents()[0];
    assert.equal(event.orderId, order.id);
    assert.deepEqual(event.items, [{sku:'TEST',quantity:2}]);
    restored.eventPublished(event.eventId);
    assert.equal(new Store(dir).pendingEvents().length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('account carts adopt a guest bag once and cannot be accessed with another account or a cart cookie alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'robotshop-account-store-'));
  try {
    const store = new Store(dir), guest = store.session();
    store.update(guest, 'TEST', 1, products);
    const alice = store.session(guest, 'alice');
    assert.notEqual(alice, guest);
    assert.equal(store.state.sessions[guest], undefined);
    assert.equal(store.cart(alice, products).items.length, 1);
    const bob = store.session(alice, 'bob');
    assert.equal(store.cart(bob, products).items.length, 0);
    const anonymous = store.session(alice);
    assert.equal(store.cart(anonymous, products).items.length, 0);
    store.state.sessions[alice].expires = 0;
    const returned = store.session(undefined, 'alice');
    assert.equal(returned, alice);
    assert.equal(store.cart(returned, products).items[0].quantity, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
