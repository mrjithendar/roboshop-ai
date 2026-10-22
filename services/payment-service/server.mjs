import { businessSpan, timingSafeEqual } from 'node:crypto';
import { serve, json, body, HttpError } from './lib/runtime.mjs';
import { Razorpay } from './razorpay.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function startPaymentService(provider = new Razorpay()) {
return serve('payment-service', 4105, async (req, res, url) => {
  const expected = process.env.PAYMENT_SERVICE_TOKEN || '';
  const supplied = String(req.headers['x-payment-service-token'] || '');
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new HttpError(403, 'Payment service access denied.');
  if (req.method === 'GET' && url.pathname === '/api/payment/config') return json(res, provider.settings());
  if (req.method !== 'POST') return;
  const data = await body(req, 131072);
  if (url.pathname === '/api/payment/config') return json(res, provider.context(data).settings());
  if (url.pathname === '/api/payment/orders') return json(res, await businessSpan("payment.create_order", () => provider.create(data)));
  if (url.pathname === '/api/payment/recover') return json(res, await businessSpan("payment.recover", () => provider.recover(data)));
  if (url.pathname === '/api/payment/lookup') return json(res, await businessSpan("payment.lookup", () => provider.lookup(data)));
  if (url.pathname === '/api/payment/verify') return json(res, await businessSpan("payment.verify", () => provider.verify(data)));
  if (url.pathname === '/api/payment/reconcile') return json(res, await businessSpan("payment.reconcile", () => provider.reconcile(data)));
  if (url.pathname === '/api/payment/webhook-check') return json(res, await businessSpan("payment.verify_signature", () => provider.webhook(data)));
});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startPaymentService();
