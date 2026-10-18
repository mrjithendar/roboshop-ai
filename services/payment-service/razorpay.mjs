import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, clientSpan } from '../shared/runtime.mjs';

export function signatureValid(payload, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export class Razorpay {
  constructor(config = process.env, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  settings() {
    const c = this.config, mode = c.PAYMENT_MODE || 'live';
    const validKey = new RegExp(`^rzp_${mode === 'live' ? 'live' : 'test'}_[A-Za-z0-9]+$`).test(c.RAZORPAY_KEY_ID || '');
    const enabled = ['live', 'test'].includes(mode) && validKey && Boolean(c.RAZORPAY_KEY_SECRET && c.RAZORPAY_WEBHOOK_SECRET && c.PAYMENT_SERVICE_TOKEN) && (mode !== 'live' || /^https:\/\//.test(c.PUBLIC_ORIGIN || ''));
    return { provider: 'razorpay', mode, enabled, ...(enabled ? { keyId: c.RAZORPAY_KEY_ID } : {}), message: enabled ? (mode === 'live' ? 'Secure payment through Razorpay.' : 'Razorpay test mode. No real payment will be collected.') : 'Payments are not configured yet. Please contact the store.' };
  }
  async api(path, data) {
    if (!this.settings().enabled) throw new HttpError(503, 'Payments are not configured.');
    try {
      const response = await clientSpan('HTTP Razorpay', async () => { const result = await this.fetcher(`https://api.razorpay.com/v1${path}`, {
        method: data ? 'POST' : 'GET', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.RAZORPAY_KEY_ID}:${this.config.RAZORPAY_KEY_SECRET}`).toString('base64')}`, 'content-type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }); if (!result.ok) throw new HttpError(502, 'Payment provider unavailable.'); return result; }, { 'server.address': 'api.razorpay.com', 'http.request.method': data ? 'POST' : 'GET' });
      if (!response.ok) throw new Error('Provider rejected request');
      return await response.json();
    } catch { throw new HttpError(502, 'Payment provider unavailable. Check payment status before trying again.'); }
  }
  async create({ amount, currency, receipt }) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || currency !== 'EUR' || !/^[a-f0-9-]{36}$/.test(receipt || '')) throw new HttpError(400, 'Invalid payment order.');
    const order = await this.api('/orders', { amount, currency, receipt, partial_payment: false });
    if (!/^order_[A-Za-z0-9]+$/.test(order.id || '') || order.amount !== amount || order.currency !== currency || order.receipt !== receipt || order.status !== 'created') throw new HttpError(502, 'Unexpected payment order response.');
    return { orderId: order.id, amount, currency, keyId: this.config.RAZORPAY_KEY_ID };
  }
  validatePayment(payment, expected) {
    if (payment.order_id !== expected.orderId || payment.amount !== expected.amount || payment.currency !== expected.currency || !/^pay_[A-Za-z0-9]+$/.test(payment.id || '')) throw new HttpError(409, 'Payment does not match this order.');
    if (payment.status !== 'captured' || payment.captured !== true || (payment.amount_refunded || 0) !== 0) return { verified: false, status: 'pending' };
    return { verified: true, status: 'paid', paymentId: payment.id, orderId: payment.order_id, amount: payment.amount, currency: payment.currency };
  }
  async verify(data) {
    if (!/^order_[A-Za-z0-9]+$/.test(data.orderId || '') || !/^pay_[A-Za-z0-9]+$/.test(data.paymentId || '') || !signatureValid(`${data.orderId}|${data.paymentId}`, data.signature, this.config.RAZORPAY_KEY_SECRET)) throw new HttpError(400, 'Invalid payment signature.');
    const payment = await this.api(`/payments/${data.paymentId}`);
    if (payment.id !== data.paymentId) throw new HttpError(409, 'Payment ID mismatch.');
    return this.validatePayment(payment, data);
  }
  async reconcile(data) {
    if (!/^order_[A-Za-z0-9]+$/.test(data.orderId || '')) throw new HttpError(400, 'Invalid order ID.');
    const order = await this.api(`/orders/${data.orderId}`);
    if (order.amount !== data.amount || order.currency !== data.currency) throw new HttpError(409, 'Order amount mismatch.');
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
    if (!signatureValid(bytes, signature, this.config.RAZORPAY_WEBHOOK_SECRET)) throw new HttpError(400, 'Invalid webhook signature.');
    let event;
    try { event = JSON.parse(bytes); } catch { throw new HttpError(400, 'Invalid webhook JSON.'); }
    if (event.event !== 'payment.captured') return { ignored: true };
    const payment = event.payload?.payment?.entity;
    if (!payment) throw new HttpError(400, 'Missing payment entity.');
    return { ignored: false, orderId: payment.order_id, paymentId: payment.id };
  }
}
