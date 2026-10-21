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

test('INR prices are passed to Razorpay as paise without another conversion',async()=>{
 const provider=new Razorpay(config,async(url,options)=>({ok:true,json:async()=>({id:'order_INR',...JSON.parse(options.body),status:'created'})}));
 const order=await provider.create({amount:99900,currency:'INR',receipt:'12345678-1234-1234-1234-123456789abc'});
 assert.equal(order.currency,'INR');assert.equal(order.amount,99900);
});

const receipt = '11111111-1111-1111-1111-111111111111';
const recoverInput = { receipt, amount: 4200, currency: 'EUR', mode: 'test', keyId: config.RAZORPAY_KEY_ID };
const providerOrder = { id: 'order_UNIT', receipt, amount: 4200, currency: 'EUR', status: 'created', partial_payment: false };

test('ambiguous creation recovery only reads, matches exact receipt, and keeps original amount/currency', async () => {
  const paths = [];
  const provider = new Razorpay(config, async (url, options) => {
    paths.push(url); assert.equal(options.method, 'GET');
    return { ok: true, json: async () => ({ items: [providerOrder] }) };
  });
  const result = await provider.recover(recoverInput);
  assert.equal(result.found, true); assert.equal(result.orderId, 'order_UNIT');
  assert.equal(result.mode, 'test'); assert.equal(result.keyId, config.RAZORPAY_KEY_ID);
  assert.match(paths[0], /orders\?receipt=11111111-1111-1111-1111-111111111111&count=100$/);
  await assert.rejects(provider.recover({ ...recoverInput, amount: 1 }), /amount mismatch/);
  await assert.rejects(provider.recover({ ...recoverInput, currency: 'INR' }), /amount mismatch/);
});

test('missing, duplicate or malformed recovery results never create another order', async () => {
  let items = [];
  const provider = new Razorpay(config, async (_, options) => {
    assert.equal(options.method, 'GET'); return { ok: true, json: async () => ({ items }) };
  });
  assert.deepEqual(await provider.recover(recoverInput), { found: false });
  items = [{ ...providerOrder, receipt: 'other' }];
  assert.deepEqual(await provider.recover(recoverInput), { found: false });
  items = [providerOrder, { ...providerOrder, id: 'order_OTHER' }];
  await assert.rejects(provider.recover(recoverInput), /Multiple provider orders/);
  items = [{ ...providerOrder, partial_payment: true }];
  await assert.rejects(provider.recover(recoverInput), /Unexpected/);
  items = null;
  await assert.rejects(provider.recover(recoverInput), /Ambiguous/);
});

test('create and recovery refuse changed payment account or mode before network I/O', async () => {
  const provider = new Razorpay(config, () => assert.fail('Unexpected provider request'));
  for (const method of ['create', 'recover', 'verify', 'reconcile']) {
    await assert.rejects(provider[method]({ ...recoverInput, mode: 'live' }), /account changed/);
    await assert.rejects(provider[method]({ ...recoverInput, keyId: 'rzp_test_OTHER' }), /account changed/);
  }
});

test('orphan-order lookup validates provider identity; reconcile validates captured payment', async () => {
  let wrongId = false;
  const provider = new Razorpay(config, async url => ({ ok: true, json: async () => url.endsWith('/payments')
    ? { items: [captured] }
    : { ...providerOrder, status: 'paid', id: wrongId ? 'order_OTHER' : 'order_UNIT' } }));
  assert.equal((await provider.lookup(expected)).receipt, receipt);
  assert.equal((await provider.reconcile(expected)).verified, true);
  wrongId = true;
  await assert.rejects(provider.lookup(expected), /ID mismatch/);
  await assert.rejects(provider.reconcile(expected), /amount mismatch/);
});

const dual = { ...config, PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'https://shop.example',
  RAZORPAY_TEST_KEY_ID: config.RAZORPAY_KEY_ID, RAZORPAY_TEST_KEY_SECRET: config.RAZORPAY_KEY_SECRET,
  RAZORPAY_TEST_WEBHOOK_SECRET: config.RAZORPAY_WEBHOOK_SECRET,
  RAZORPAY_LIVE_KEY_ID: 'rzp_live_OTHER', RAZORPAY_LIVE_KEY_SECRET: 'live-unit-secret', RAZORPAY_LIVE_WEBHOOK_SECRET: 'live-webhook-unit' };

test('default is test and live creates require explicit merchant provenance', async () => {
  assert.equal(new Razorpay({ ...config, PAYMENT_MODE: undefined }).settings().mode, 'test');
  const provider = new Razorpay(dual, () => assert.fail('Live network must not be called'));
  for (const fields of [{}, {demo:true, inventoryProvenance:'demo'}, {demo:false, inventoryProvenance:'unknown'}]) {
    await assert.rejects(provider.create({amount:10000,currency:'INR',receipt,...fields}), /inventory/);
  }
});
test('old test orders use only original test credentials after switching to live', async () => {
  let calls = 0;
  const provider = new Razorpay(dual, async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64'));
    return {ok:true,json:async()=>url.endsWith('/payments') ? {items:[captured]} : url.includes('/payments/') ? captured : {...providerOrder,status:'paid'}};
  });
  assert.equal((await provider.verify({...expected, mode:'test', keyId:config.RAZORPAY_KEY_ID, paymentId:'pay_UNIT', signature})).verified,true);
  assert.equal((await provider.reconcile({...expected, mode:'test', keyId:config.RAZORPAY_KEY_ID})).verified,true);
  assert.equal(calls,3);
  assert.equal(provider.settings().mode,'live'); // Selection never mutates shared configuration.
  assert.equal(provider.context({mode:'test',keyId:config.RAZORPAY_KEY_ID}).settings().mode,'test');
  const missing = new Razorpay({...dual,RAZORPAY_KEY_ID:undefined,RAZORPAY_TEST_KEY_SECRET:undefined},()=>assert.fail('No cross-environment fallback'));
  await assert.rejects(missing.reconcile({...expected,mode:'test',keyId:config.RAZORPAY_KEY_ID}),/account changed/);
});
test('webhooks identify their authenticated environment and reject shared secrets', () => {
  const raw = Buffer.from(JSON.stringify({event:'payment.captured',payload:{payment:{entity:captured}}}));
  const sig = createHmac('sha256',config.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const event = new Razorpay(dual).webhook({raw:raw.toString('base64'),signature:sig});
  assert.equal(event.mode,'test'); assert.equal(event.keyId,config.RAZORPAY_KEY_ID);
  assert.throws(()=>new Razorpay({...dual,RAZORPAY_LIVE_WEBHOOK_SECRET:config.RAZORPAY_WEBHOOK_SECRET}).webhook({raw:raw.toString('base64'),signature:sig}),/ambiguous/);
});
test('test mode never accepts authorized-only, refunded, wrong-order or replayed IDs', async () => {
  for(const change of [{status:'authorized',captured:false},{amount_refunded:1}]) {
    const provider = new Razorpay(config,async()=>({ok:true,json:async()=>({...captured,...change})}));
    assert.equal((await provider.verify({...expected,paymentId:'pay_UNIT',signature})).verified,false);
  }
  for(const change of [{order_id:'order_OTHER'},{id:'pay_OTHER'}]) {
    const provider = new Razorpay(config,async()=>({ok:true,json:async()=>({...captured,...change})}));
    await assert.rejects(provider.verify({...expected,paymentId:'pay_UNIT',signature}),/match/);
  }
});
