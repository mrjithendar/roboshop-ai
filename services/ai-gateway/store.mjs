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
    for (const [key, value] of Object.entries(next.sessions)) if (value.expires <= now && !this.pending(key)) delete next.sessions[key];
    if (Object.keys(next.sessions).length >= 10000) throw new HttpError(503, 'Session capacity reached.');
    id = randomUUID();
    next.sessions[id] = { items: {}, expires: now + 7 * 86400000 };
    this.save(next);
    return id;
  }
  pending(id) { return this.state.orders.find(o => o.session === id && ['creating', 'payment_pending', 'payment_review'].includes(o.status)); }
  available(product) {
    const reserved = this.state.orders.filter(o => ['creating', 'payment_pending', 'payment_review'].includes(o.status)).reduce((sum, o) => sum + (o.items.find(p => p.sku === product.sku)?.quantity || 0), 0);
    return Math.max(0, product.instock - (this.state.sold[product.sku] || 0) - reserved);
  }
  cart(id, products) {
    const items = Object.entries(this.state.sessions[id].items).map(([sku, quantity]) => {
      const p = products.find(p => p.sku === sku);
      if (!p) throw new HttpError(409, 'A cart product is no longer available.');
      return { ...p, instock: this.available(p), quantity, lineTotal: Math.round(p.price * 100) * quantity / 100 };
    });
    const subtotal = items.reduce((total, item) => total + Math.round(item.lineTotal * 100), 0) / 100;
    const shipping = items.length ? this.state.sessions[id].shipping || null : null;
    return { items, subtotal, shipping, total: (Math.round(subtotal * 100) + Math.round((shipping?.cost || 0) * 100)) / 100, currency: 'EUR' };
  }
  update(id, sku, quantity, products) {
    if (this.pending(id)) throw new HttpError(409, 'A payment is pending. Complete or reconcile it before changing your bag.');
    if (typeof sku !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sku) || !Number.isInteger(quantity) || quantity < 0 || quantity > 20) throw new HttpError(400, 'Use a valid SKU and an integer quantity from 0 to 20.');
    const p = products.find(p => p.sku === sku);
    if (!p) throw new HttpError(404, 'Product not found.');
    if (quantity > this.available(p)) throw new HttpError(409, 'Requested quantity exceeds available stock.');
    const next = structuredClone(this.state);
    if (quantity === 0) delete next.sessions[id].items[sku]; else next.sessions[id].items[sku] = quantity;
    this.save(next);
    return this.cart(id, products);
  }
  setShipping(id, shipping, products) {
    if (this.pending(id)) throw new HttpError(409, 'A payment is pending. Shipping cannot be changed.');
    const next = structuredClone(this.state);
    next.sessions[id].shipping = shipping;
    this.save(next);
    return this.cart(id, products);
  }
  beginPayment(id, key, products) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw new HttpError(400, 'A valid idempotency key is required.');
    const previous = this.state.orders.find(o => o.session === id && o.key === key);
    if (previous) return previous;
    if (this.pending(id)) return this.pending(id);
    const cart = this.cart(id, products);
    if (!cart.items.length) throw new HttpError(400, 'Your cart is empty.');
    if (cart.items.some(p => p.quantity > p.instock)) throw new HttpError(409, 'Stock changed. Update your cart before checking out.');
    if (!cart.shipping) throw new HttpError(400, 'Add a delivery address and calculate shipping before payment.');
    if (Date.now() - Date.parse(cart.shipping.quotedAt) > 86400000) throw new HttpError(409, 'Your shipping quote expired. Calculate shipping again.');
    if (this.state.orders.length >= 10000) throw new HttpError(503, 'Order capacity reached.');
    const order = { id: randomUUID(), session: id, key, ...cart, createdAt: new Date().toISOString(), status: 'creating', paymentCaptured: false };
    const next = structuredClone(this.state);
    next.orders.push(order);
    this.save(next);
    return order;
  }
  paymentOrder(orderId, sessionId) {
    const order = this.state.orders.find(o => o.id === orderId && (sessionId === undefined || o.session === sessionId));
    if (!order) throw new HttpError(404, 'Order not found.');
    return order;
  }
  attachPayment(id, providerOrder) {
    const next = structuredClone(this.state), order = next.orders.find(o => o.id === id);
    if (!order || order.status !== 'creating') throw new HttpError(409, 'Payment order state changed.');
    if (providerOrder.amount !== Math.round(order.total * 100) || providerOrder.currency !== order.currency) throw new HttpError(409, 'Payment amount mismatch.');
    order.razorpayOrderId = providerOrder.orderId;
    order.status = 'payment_pending'; this.save(next); return order;
  }
  reviewPayment(id) {
    const next = structuredClone(this.state), order = next.orders.find(o => o.id === id);
    if (order?.status === 'creating') { order.status = 'payment_review'; this.save(next); }
  }
  markPaid(id, payment) {
    const current = this.paymentOrder(id);
    if (payment.verified !== true || payment.orderId !== current.razorpayOrderId || payment.amount !== Math.round(current.total * 100) || payment.currency !== current.currency) throw new HttpError(409, 'Payment confirmation mismatch.');
    if (current.status === 'paid') {
      if (current.paymentId !== payment.paymentId) throw new HttpError(409, 'Payment ID mismatch.');
      return current;
    }
    if (current.status !== 'payment_pending' || this.state.orders.some(o => o.paymentId === payment.paymentId)) throw new HttpError(409, 'Payment already used or order state invalid.');
    const next = structuredClone(this.state), order = next.orders.find(o => o.id === id);
    order.status = 'paid'; order.paymentCaptured = true; order.paymentId = payment.paymentId; order.paidAt = new Date().toISOString();
    for (const p of order.items) next.sold[p.sku] = (next.sold[p.sku] || 0) + p.quantity;
    if (next.sessions[order.session]) next.sessions[order.session].items = {};
    this.save(next); return order;
  }
}
