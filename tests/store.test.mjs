import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../services/ai-gateway/store.mjs';
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
    const order = store.checkout(alice, 'idempotency-key-0001', products);
    assert.equal(order.paymentCaptured, false);
    assert.equal(store.checkout(alice, 'idempotency-key-0001', products).id, order.id);
    assert.throws(() => store.checkout(bob, 'idempotency-key-0002', products), /Stock changed/);
    const restored = new Store(dir);
    assert.equal(restored.available(products[0]), 0);
    assert.equal(restored.cart(alice, products).items.length, 0);
    assert.equal(restored.state.orders.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
