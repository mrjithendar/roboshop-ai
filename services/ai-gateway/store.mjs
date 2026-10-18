import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../shared/runtime.mjs';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'store.json');
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { sessions: {}, orders: [], sold: {} };
    if (!this.state.sessions || !Array.isArray(this.state.orders) || !this.state.sold) throw new Error('Invalid store data. Restore a valid backup; refusing to overwrite it.');
  }
  save(next) {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.state = next;
  }
  session(id) {
    const now = Date.now();
    if (id && this.state.sessions[id]?.expires > now) return id;
    const next = structuredClone(this.state);
    for (const [key, value] of Object.entries(next.sessions)) if (value.expires <= now) delete next.sessions[key];
    if (Object.keys(next.sessions).length >= 10000) throw new HttpError(503, 'Demo session capacity reached.');
    id = randomUUID();
    next.sessions[id] = { items: {}, expires: now + 7 * 86400000 };
    this.save(next);
    return id;
  }
  available(product) { return Math.max(0, product.instock - (this.state.sold[product.sku] || 0)); }
  cart(id, products) {
    const items = Object.entries(this.state.sessions[id].items).map(([sku, quantity]) => {
      const p = products.find(p => p.sku === sku);
      if (!p) throw new HttpError(409, 'A cart product is no longer available.');
      return { ...p, instock: this.available(p), quantity, lineTotal: Math.round(p.price * 100) * quantity / 100 };
    });
    return { items, total: items.reduce((total, item) => total + Math.round(item.lineTotal * 100), 0) / 100, currency: 'EUR' };
  }
  update(id, sku, quantity, products) {
    if (typeof sku !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sku) || !Number.isInteger(quantity) || quantity < 0 || quantity > 20) throw new HttpError(400, 'Use a valid SKU and an integer quantity from 0 to 20.');
    const p = products.find(p => p.sku === sku);
    if (!p) throw new HttpError(404, 'Product not found.');
    if (quantity > this.available(p)) throw new HttpError(409, 'Requested quantity exceeds available stock.');
    const next = structuredClone(this.state);
    if (quantity === 0) delete next.sessions[id].items[sku]; else next.sessions[id].items[sku] = quantity;
    this.save(next);
    return this.cart(id, products);
  }
  checkout(id, key, products) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw new HttpError(400, 'A valid idempotency key is required.');
    const previous = this.state.orders.find(o => o.session === id && o.key === key);
    if (previous) return previous;
    const cart = this.cart(id, products);
    if (!cart.items.length) throw new HttpError(400, 'Your cart is empty.');
    if (cart.items.some(p => p.quantity > p.instock)) throw new HttpError(409, 'Stock changed. Update your cart before checking out.');
    if (this.state.orders.length >= 10000) throw new HttpError(503, 'Demo order capacity reached.');
    const order = { id: randomUUID(), session: id, key, ...cart, createdAt: new Date().toISOString(), status: 'demo-confirmed', paymentCaptured: false };
    const next = structuredClone(this.state);
    next.orders.push(order);
    for (const p of cart.items) next.sold[p.sku] = (next.sold[p.sku] || 0) + p.quantity;
    next.sessions[id].items = {};
    this.save(next);
    return order;
  }
}
