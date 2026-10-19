import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Razorpay, signatureValid } from '../razorpay.mjs';
const config = { PAYMENT_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_UNIT', RAZORPAY_KEY_SECRET: 'unit-secret', RAZORPAY_WEBHOOK_SECRET: 'webhook-secret', PAYMENT_SERVICE_TOKEN: 'internal-secret' };
const expected = { orderId: 'order_UNIT', amount: 4200, currency: 'EUR' };
const signature = createHmac('sha256', config.RAZORPAY_KEY_SECRET).update('order_UNIT|pay_UNIT').digest('hex');
const captured = { id: 'pay_UNIT', order_id: 'order_UNIT', amount: 4200, currency: 'EUR', status: 'captured', captured: true, amount_refunded: 0 };

test('live payment mode fails closed without correct keys, webhook secret and HTTPS', () => {
  assert.equal(new Razorpay({}).settings().enabled, false);
  assert.equal(new Razorpay({ ...config, PAYMENT_MODE: 'live' }).settings().enabled, false);
  assert.equal(new Razorpay({ ...config, PAYMENT_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_live_UNIT', PUBLIC_ORIGIN: 'https://shop.example' }).settings().enabled, true);
});
test('payment must have a valid signature and matching captured amount/currency/order', async () => {
  const provider = new Razorpay(config, async () => ({ ok: true, json: async () => captured }));
  assert.equal((await provider.verify({ ...expected, paymentId: 'pay_UNIT', signature })).verified, true);
  await assert.rejects(provider.verify({ ...expected, paymentId: 'pay_UNIT', signature: '0'.repeat(64) }), /signature/);
  await assert.rejects(provider.verify({ ...expected, amount: 1, paymentId: 'pay_UNIT', signature }), /match/);
  await assert.rejects(provider.verify({ ...expected, currency: 'INR', paymentId: 'pay_UNIT', signature }), /match/);
  assert.equal(provider.validatePayment({ ...captured, status: 'authorized', captured: false }, expected).verified, false);
  assert.equal(provider.validatePayment({ ...captured, amount_refunded: 4200 }, expected).verified, false);
});
test('webhooks verify the exact raw bytes and reject modified payloads', () => {
  const provider = new Razorpay(config);
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: captured } } });
  const signature = createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  assert.equal(provider.webhook({ raw: Buffer.from(raw).toString('base64'), signature }).orderId, expected.orderId);
  assert.throws(() => provider.webhook({ raw: Buffer.from(raw + ' ').toString('base64'), signature }), /signature/);
  assert.equal(signatureValid(raw, 'invalid', config.RAZORPAY_WEBHOOK_SECRET), false);
});
test('Razorpay order is server-priced and never permits partial payment', async () => {
  const provider = new Razorpay(config, async (url, options) => {
    assert.equal(url, 'https://api.razorpay.com/v1/orders');
    const data = JSON.parse(options.body); assert.equal(data.partial_payment, false); assert.equal(data.amount, 4200);
    return { ok: true, json: async () => ({ id: 'order_UNIT', status: 'created', ...data }) };
  });
  assert.equal((await provider.create({ amount: 4200, currency: 'EUR', receipt: '11111111-1111-1111-1111-111111111111' })).orderId, 'order_UNIT');
  await assert.rejects(provider.create({ amount: -1, currency: 'EUR', receipt: 'bad' }), /Invalid/);
});

test('USD orders retain their currency and cents through provider creation',async()=>{
 const provider=new Razorpay(config,async(url,options)=>({ok:true,json:async()=>({id:'order_USD',...JSON.parse(options.body),status:'created'})}));
 const order=await provider.create({amount:19900,currency:'USD',receipt:'12345678-1234-1234-1234-123456789abc'});
 assert.equal(order.currency,'USD');assert.equal(order.amount,19900);
});
