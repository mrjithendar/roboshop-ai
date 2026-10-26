import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, clientSpan } from './lib/runtime.mjs';

// The ledger currently supports only currencies with two decimal subunits.
const CHECKOUT_CURRENCIES = ['EUR', 'USD', 'INR', 'GBP', 'SGD', 'AUD', 'CAD', 'NZD', 'CHF', 'CNY', 'HKD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'NOK', 'SEK', 'TRY', 'BRL', 'MXN', 'ZAR', 'MYR', 'PHP', 'THB', 'IDR', 'ILS'];

export function signatureValid(payload, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export class Razorpay {
  constructor(config = process.env, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  credentials(mode = this.config.PAYMENT_MODE || 'test') {
    const c = this.config, prefix = `RAZORPAY_${mode.toUpperCase()}_`;
    // Legacy credentials are usable only in the environment identified by their key ID.
    const legacy = String(c.RAZORPAY_KEY_ID || '').startsWith(`rzp_${mode}_`);
    const explicit = Boolean(c[prefix + 'KEY_ID']);
    return { keyId: explicit ? c[prefix + 'KEY_ID'] : legacy ? c.RAZORPAY_KEY_ID : undefined,
      secret: explicit ? c[prefix + 'KEY_SECRET'] : legacy ? c.RAZORPAY_KEY_SECRET : undefined,
      webhook: explicit ? c[prefix + 'WEBHOOK_SECRET'] : legacy ? c.RAZORPAY_WEBHOOK_SECRET : undefined };
  }
  settings() {
    const c = this.config, mode = c.PAYMENT_MODE || 'test', keys = this.credentials(mode);
    const validKey = new RegExp(`^rzp_${mode}_[A-Za-z0-9]+$`).test(keys.keyId || '');
    const enabled = ['live', 'test'].includes(mode) && validKey && Boolean(keys.secret && keys.webhook && c.PAYMENT_SERVICE_TOKEN) && (mode !== 'live' || /^https:\/\//.test(c.PUBLIC_ORIGIN || ''));
    return { provider: 'razorpay', mode, enabled, ...(enabled ? { keyId: keys.keyId } : {}), message: mode === 'test' ? 'Demo checkout — no real money charged' + (enabled ? '' : '. Test payment credentials are not configured.') : enabled ? 'Live checkout — real money will be charged.' : 'Payments are not configured yet. Please contact the store.' };
  }
  async api(path, data) {
    if (!this.settings().enabled) throw new HttpError(503, 'Payments are not configured.');
    try {
      const response = await clientSpan('HTTP Razorpay', async ctx => { const result = await this.fetcher(`https://api.razorpay.com/v1${path}`, {
        method: data ? 'POST' : 'GET', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Basic ${Buffer.from(`${this.credentials().keyId}:${this.credentials().secret}`).toString('base64')}`, 'content-type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }); ctx.httpResponseStatus = result.status; if (!result.ok) throw new HttpError(502, 'Payment provider unavailable.'); return result; }, { 'server.address': 'api.razorpay.com', 'http.request.method': data ? 'POST' : 'GET' });
      if (!response.ok) throw new Error('Provider rejected request');
      return await response.json();
    } catch { throw new HttpError(502, 'Payment provider unavailable. Check payment status before trying again.'); }
  }
  context(data) {
    const mode = data.mode || this.settings().mode;
    if (!['test', 'live'].includes(mode)) throw new HttpError(409, 'Payment account changed. Original environment unavailable.');
    const scoped = mode === this.settings().mode ? this : new Razorpay({ ...this.config, PAYMENT_MODE: mode }, this.fetcher);
    const settings = scoped.settings();
    if (!settings.enabled || (data.keyId && data.keyId !== settings.keyId)) throw new HttpError(409, 'Payment account changed. Restore the original environment credentials for this order.');
    return scoped;
  }
  async create(data) {
    const scoped = this.context(data);
    if (scoped !== this) return scoped.create(data);
    if (this.settings().mode === 'live' && (data.demo !== false || data.inventoryProvenance !== 'merchant')) throw new HttpError(409, 'Demo or unverified inventory cannot use live payments.');
    const { amount, currency, receipt } = data;
    if (!Number.isSafeInteger(amount) || amount <= 0 || currency !== 'INR' || !/^[a-f0-9-]{36}$/.test(receipt || '')) throw new HttpError(400, 'Invalid payment order.');
    const order = await this.api('/orders', { amount, currency, receipt, partial_payment: false });
    if (!/^order_[A-Za-z0-9]+$/.test(order.id || '') || order.amount !== amount || order.currency !== currency || order.receipt !== receipt || order.status !== 'created') throw new HttpError(502, 'Unexpected payment order response.');
    return { orderId: order.id, receipt, amount, currency, keyId: this.credentials().keyId, mode: this.settings().mode };
  }
  orderResult(order) {
    if (!/^order_[A-Za-z0-9]+$/.test(order.id || '') || !/^[a-f0-9-]{36}$/.test(order.receipt || '') ||
        !Number.isSafeInteger(order.amount) || order.amount <= 0 || !CHECKOUT_CURRENCIES.includes(order.currency) ||
        !['created', 'attempted', 'paid'].includes(order.status) || order.partial_payment === true) throw new HttpError(502, 'Unexpected payment order response.');
    return { orderId: order.id, receipt: order.receipt, amount: order.amount, currency: order.currency,
      keyId: this.credentials().keyId, mode: this.settings().mode };
  }
  async lookup(data) {
    const scoped = this.context(data);
    if (scoped !== this) return scoped.lookup(data);
    if (!/^order_[A-Za-z0-9]+$/.test(data.orderId || '')) throw new HttpError(400, 'Invalid order ID.');
    const order = await this.api(`/orders/${data.orderId}`);
    if (order.id !== data.orderId) throw new HttpError(409, 'Order ID mismatch.');
    return this.orderResult(order);
  }
  async recover(data) {
    const scoped = this.context(data);
    if (scoped !== this) return scoped.recover(data);
    if (!/^[a-f0-9-]{36}$/.test(data.receipt || '')) throw new HttpError(400, 'Invalid receipt.');
    // Read-only recovery. Absence is NOT proof that a timed-out POST failed.
    const result = await this.api(`/orders?receipt=${encodeURIComponent(data.receipt)}&count=100`);
    if (!Array.isArray(result.items) || result.items.length >= 100) throw new HttpError(409, 'Ambiguous receipt lookup. Manual reconciliation required.');
    const matches = result.items.filter(order => order.receipt === data.receipt);
    if (!matches.length) return { found: false };
    if (matches.length !== 1) throw new HttpError(409, 'Multiple provider orders match this receipt. Manual reconciliation required.');
    const order = this.orderResult(matches[0]);
    if (order.amount !== data.amount || order.currency !== data.currency) throw new HttpError(409, 'Recovered order amount mismatch.');
    return { found: true, ...order };
  }
  validatePayment(payment, expected) {
    if (payment.order_id !== expected.orderId || payment.amount !== expected.amount || payment.currency !== expected.currency || !/^pay_[A-Za-z0-9]+$/.test(payment.id || '')) throw new HttpError(409, 'Payment does not match this order.');
    if (payment.status !== 'captured' || payment.captured !== true || (payment.amount_refunded || 0) !== 0) return { verified: false, status: 'pending' };
    return { verified: true, status: 'paid', mode: this.settings().mode, keyId: this.credentials().keyId, paymentId: payment.id, orderId: payment.order_id, amount: payment.amount, currency: payment.currency };
  }
  async verify(data) {
    const scoped = this.context(data);
    if (scoped !== this) return scoped.verify(data);
    if (!/^order_[A-Za-z0-9]+$/.test(data.orderId || '') || !/^pay_[A-Za-z0-9]+$/.test(data.paymentId || '') || !signatureValid(`${data.orderId}|${data.paymentId}`, data.signature, this.credentials().secret)) throw new HttpError(400, 'Invalid payment signature.');
    const payment = await this.api(`/payments/${data.paymentId}`);
    if (payment.id !== data.paymentId) throw new HttpError(409, 'Payment ID mismatch.');
    return this.validatePayment(payment, data);
  }
  async reconcile(data) {
    const scoped = this.context(data);
    if (scoped !== this) return scoped.reconcile(data);
    if (!/^order_[A-Za-z0-9]+$/.test(data.orderId || '')) throw new HttpError(400, 'Invalid order ID.');
    const order = await this.api(`/orders/${data.orderId}`);
    if (order.id !== data.orderId || order.amount !== data.amount || order.currency !== data.currency) throw new HttpError(409, 'Order amount mismatch.');
    if (order.status !== 'paid') return { verified: false, status: 'pending' };
    const payments = await this.api(`/orders/${data.orderId}/payments`);
    for (const payment of payments.items || []) {
      if (payment.status === 'captured') return this.validatePayment(payment, data);
    }
    return { verified: false, status: 'pending' };
  }
  webhook({ raw, signature }) {
    if (typeof raw !== 'string' || raw.length > 90000) throw new HttpError(400, 'Invalid webhook.');
    const bytes = Buffer.from(raw, 'base64');
    const environments = ['test', 'live'].filter(mode => signatureValid(bytes, signature, this.credentials(mode).webhook));
    if (environments.length !== 1) throw new HttpError(400, 'Invalid or ambiguous webhook signature.');
    const mode = environments[0], keyId = this.credentials(mode).keyId;
    let event;
    try { event = JSON.parse(bytes); } catch { throw new HttpError(400, 'Invalid webhook JSON.'); }
    if (event.event !== 'payment.captured') return { ignored: true };
    const payment = event.payload?.payment?.entity;
    if (!payment) throw new HttpError(400, 'Missing payment entity.');
    return { ignored: false, orderId: payment.order_id, paymentId: payment.id, mode, keyId };
  }
}
