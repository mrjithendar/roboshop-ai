import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const accountScript = (await readFile(new URL('../dist/account.js', import.meta.url), 'utf8')).replace(/^export /gm, '').replace(/^import .*$/gm, '');
const pathsScript = (await readFile(new URL('../dist/paths.js', import.meta.url), 'utf8')).replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify('https://shop.example/paths.js'));
const checkoutHtml = await readFile(new URL('../dist/checkout.html', import.meta.url), 'utf8');
const checkoutScript = pathsScript + '\n' + accountScript + '\n' + (await readFile(new URL('../dist/checkout.js', import.meta.url), 'utf8')).replace(/^export \{\};?$/m, '').replace(/^import .*$/gm, '');
const script = pathsScript + '\n' + accountScript + '\n' + (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8')).replace(/^export \{\};?$/m, '').replace(/^import .*$/gm, '');
const authHtml = await readFile(new URL('../dist/auth.html', import.meta.url), 'utf8');
const authScript = pathsScript + '\n' + accountScript + '\n' + (await readFile(new URL('../dist/auth.js', import.meta.url), 'utf8')).replace(/^import .*$/gm, '').replace('location.replace(destination)', 'window.testRedirect = destination');
const product = { sku: 'TEST', name: '<img src=x onerror=alert(1)>', price: 12, instock: 3, categories: ['robot'], description: 'Test robot', image: '/images/placeholder.png' };
const cart = { items: [{ ...product, quantity: 1, lineTotal: 12 }], subtotal: 12, total: 15, shipping: { address: { recipient: 'Test', line1: 'Test street' }, city: { name: 'Hyderabad', country: 'IN' }, cost: 3, distanceKm: 60, quotedAt: new Date().toISOString() } };
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('UI did not reach expected state');
}
function setup(t, handler = () => undefined, storefront = false, auth = false) {
  const dom = new JSDOM(auth ? authHtml : storefront ? html : checkoutHtml, { url: auth ? 'https://shop.example/' + (auth === 'login' ? 'login' : 'register') : storefront ? 'https://shop.example/' : 'https://shop.example/checkout', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async (path, options) => {
    calls.push(path);
    const custom = await handler(path, options);
    const defaults = {
      '/api/products': { products: [product] }, '/api/recommendations': { products: [product] },
      '/api/cart': cart, '/api/payments/config': { enabled: true, message: 'Test payments' },
      '/api/auth/me': { user: { id: 'customer', name: 'Customer', email: 'customer@example.com', role: 'customer' } },
      '/api/settings': { storeName: 'RobotShop', announcement: 'Hello', supportEmail: '', checkoutEnabled: true },
      '/api/status': { assistantMode: 'catalogue-search' }, '/api/payments/current': { order: null },
      '/api/shipping/countries': { countries: [{ code: 'IN', name: 'India', cityCount: 10 }] },
    };
    if (custom) return custom;
    assert.ok(Object.hasOwn(defaults, path), `Unexpected request: ${path}`);
    return { ok: true, status: 200, json: async () => defaults[path] };
  };
  return { w, calls, boot: () => w.eval(`(async () => { ${auth ? authScript : storefront ? script : checkoutScript}\n })()`), $: selector => w.document.querySelector(selector) };
}

test('compiled storefront renders safe product text and filters the catalogue', async t => {
  const ui = setup(t, undefined, true); await ui.boot();
  assert.equal(ui.$('.product-title').textContent, product.name);
  assert.equal(ui.$('.product-title img'), null);
  ui.$('#search').value = 'not a match';
  ui.$('#search').dispatchEvent(new ui.w.Event('input'));
  assert.match(ui.$('#products').textContent, /No robots match/);
  assert.equal(ui.$('#bag-button').getAttribute('href'), '/cart');
  assert.equal(ui.$('#cart-dialog'), null);
});

test('shipping listeners register before startup requests complete', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const ui = setup(t, async () => { await gate; });
  const boot = ui.boot();
  ui.$('#cart-total').textContent = 'not rendered';
  ui.$('#shipping-form').dispatchEvent(new ui.w.Event('input'));
  assert.notEqual(ui.$('#cart-total').textContent, 'not rendered');
  release(); await boot;
  assert.equal(ui.$('#checkout').disabled, true, 'editing the destination invalidates checkout until requoted');
});

test('expired payment reference recovers the current session without blocking the bag', async t => {
  const ui = setup(t, path => path.includes('/api/payments/status?') ? { ok: false, status: 404, json: async () => ({ error: 'Order not found.' }) } : undefined);
  ui.w.localStorage.setItem('robotshop-payment-order', 'expired');
  await ui.boot();
  await waitFor(() => ui.calls.includes('/api/payments/current'));
  assert.equal(ui.w.localStorage.getItem('robotshop-payment-order'), null);
  await waitFor(() => ui.$('#cart-items').children.length === 1);
  assert.match(ui.$('#order-result').textContent, /Order expired is unavailable/);
});

test('failed checkout SDK load is retryable and never creates a payment order', async t => {
  const ui = setup(t); await ui.boot(); ui.$('#checkout').click();
  const first = ui.$('script[src*="checkout.razorpay"]'); assert.ok(first);
  first.dispatchEvent(new ui.w.Event('load')); // SDK global absent despite load event.
  await waitFor(() => ui.$('#order-result').textContent.includes('could not load'));
  assert.equal(ui.$('#checkout').disabled, false);
  ui.$('#checkout').click();
  const second = ui.$('script[src*="checkout.razorpay"]'); assert.ok(second); assert.notEqual(second, first);
  second.dispatchEvent(new ui.w.Event('error'));
  await waitFor(() => !ui.$('#checkout').disabled);
  assert.ok(!ui.calls.includes('/api/payments/orders'));
});

test('temporary payment status failures retain the order reference', async t => {
  const ui = setup(t, path => path.includes('/api/payments/status?') ? { ok: false, status: 503, json: async () => ({ error: 'Payment service unavailable.' }) } : undefined);
  ui.w.localStorage.setItem('robotshop-payment-order', 'pending-order');
  await ui.boot();
  await waitFor(() => ui.$('#checkout-error-message').textContent.includes('Payment service unavailable'));
  assert.equal(ui.w.localStorage.getItem('robotshop-payment-order'), 'pending-order');
  assert.ok(!ui.calls.includes('/api/payments/current'));
});

test('guest checkout opens login and does not load Razorpay', async t => {
  const ui = setup(t, path => path === '/api/auth/me' ? { ok: true, status: 200, json: async () => ({ user: null }) } : undefined);
  await ui.boot();
  assert.equal(ui.$('#checkout').textContent, 'Log in to checkout');
  assert.equal(ui.$('#account-dialog'), null);
  assert.equal(ui.$('#account-button').getAttribute('href'), '/login?returnTo=%2Fcheckout');
  assert.equal(ui.$('script[src*="checkout.razorpay"]'), null);
  assert.ok(!ui.calls.includes('/api/payments/orders'));
  assert.equal(ui.$('#admin-link').hidden, true);
});

test('account navigation links to the profile page and sign out updates it', async t => {
 const ui=setup(t,path=>path==='/api/auth/logout'?{ok:true,json:async()=>({loggedOut:true})}:undefined);
 await ui.boot();assert.equal(ui.$('#account-button').getAttribute('href'),'/account');
 assert.equal(ui.$('#account-dialog'),null);ui.$('#logout-button').click();
 await waitFor(()=>ui.$('#logout-button').hidden);
 assert.equal(ui.$('#account-button').textContent,'Sign in');
});

for (const action of ['register', 'login']) test(`${action} verifies before credentials and consumes failed-attempt tokens`, async t => {
  let options, reset = 0, submitted;
  const ui = setup(t, (path, request) => {
    if (path === '/api/auth/me') return { ok: true, json: async () => ({ user: null }) };
    if (path === '/api/auth/challenge') return { ok: true, json: async () => ({ provider: 'turnstile', siteKey: 'public-key', action: 'register' }) };
    if (path === '/api/auth/' + action) { submitted = JSON.parse(request.body); return { ok: false, json: async () => ({ error: 'Try another email.' }) }; }
  }, false, action);
  ui.w.turnstile = { render: (container, config) => { options = config; return 'widget'; }, remove() {}, getResponse: () => 'fresh-token', reset: () => { reset++; } };
  await ui.boot();
  assert.equal(ui.$('#account-mode'), null);
  await waitFor(() => options); assert.equal(options.action, action); assert.equal(options.sitekey, 'public-key');
  options.callback(); ui.$('#account-email').value = 'demo@example.com'; ui.$('#account-password').value = 'long-enough-test-password'; ui.$('#account-name').value = 'Demo';
  ui.$('#account-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
  await waitFor(() => reset === 1); assert.equal(submitted.challengeToken, 'fresh-token'); assert.equal(submitted.website, '');
  submitted = null; ui.$('#account-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
  await waitFor(() => /Complete the (registration|sign-in) challenge/.test(ui.$('#account-status').textContent)); assert.equal(submitted, null);
});

test('empty checkout has a recovery link and cannot start payment', async t => {
  const ui = setup(t, path => path === '/api/cart' ? {ok:true,json:async()=>({items:[],subtotal:0,total:0})} : undefined);
  await ui.boot();
  assert.equal(ui.$('#checkout-empty').hidden, false);
  assert.equal(ui.$('#checkout-columns').hidden, true);
  assert.equal(ui.$('#checkout').disabled, true);
  assert.equal(ui.$('#cart-dialog'), null);
});

test('captured payment confirms the order on the checkout page', async t => {
  let options;
  const paid = {id:'order-123',status:'paid',paymentCaptured:true,paymentId:'pay-123',total:15,currency:'EUR'};
  const ui = setup(t, path => {
    if(path === '/api/payments/orders') return {ok:true,json:async()=>({order:{...paid,status:'payment_pending',paymentCaptured:false},checkout:{}})};
    if(path === '/api/payments/verify') return {ok:true,json:async()=>paid};
  });
  ui.w.Razorpay = class {constructor(config){options=config;} open(){} on(){}};
  await ui.boot();ui.$('#checkout').click();await waitFor(()=>options);
  await options.handler({razorpay_order_id:'rzp-1',razorpay_payment_id:'pay-123',razorpay_signature:'test'});
  assert.equal(ui.$('#confirmation').hidden,false);
  assert.match(ui.$('#confirmation-details').textContent,/Payment confirmed/);
  assert.match(ui.$('#confirmation-details').textContent,/pay-123/);
  assert.equal(ui.w.localStorage.getItem('robotshop-payment-order'),null);
  assert.equal(ui.$('#cart-dialog'),null);
});

test('payment reconciliation errors block another payment until retry succeeds', async t => {
  const ui=setup(t,path=>path==='/api/payments/current'?{ok:false,status:503,json:async()=>({error:'Reconciliation unavailable'})}:undefined);
  await ui.boot();assert.equal(ui.$('#checkout').disabled,true);
  assert.equal(ui.$('#checkout-error').hidden,false);
  assert.match(ui.$('#checkout-error-message').textContent,/Reconciliation unavailable/);
});

test('cart product titles and images link to their detail page',async t=>{
 const ui=setup(t);await ui.boot();
 assert.equal(ui.$('.cart-product-link').getAttribute('href'),'/products/test');
 assert.equal(ui.$('.cart-product-image').getAttribute('href'),'/products/test');
 assert.equal(ui.$('.cart-product-link').textContent,product.name);
});

test('signed-in visitors never see the login form or load a challenge', async t => {
  const ui = setup(t, undefined, false, 'login');
  await ui.boot();
  assert.equal(ui.$('#auth-main').hidden, true);
  assert.equal(ui.w.testRedirect, '/account');
  assert.ok(!ui.calls.includes('/api/auth/challenge'));
});

test('MFA sign-in sends only the challenge and code on the second step', async t => {
  let second;
  const ui = setup(t, (path, options) => {
    const payload = path === '/api/auth/me' ? {user:null} : path === '/api/auth/challenge' ? {provider:'disabled'} : path === '/api/auth/login' ? {mfaRequired:true, challengeId:'pending'} : null;
    if (path === '/api/auth/mfa/verify') { second=JSON.parse(options.body); return {ok:false,json:async()=>({error:'Code expired'})}; }
    if (payload) return {ok:true,json:async()=>payload};
  }, false, 'login');
  await ui.boot(); ui.$('#account-email').value='alice@example.com'; ui.$('#account-password').value='correct password 123';
  ui.$('#account-form').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
  await waitFor(()=>!ui.$('#account-code-label').hidden);
  assert.equal(ui.$('#account-password').value,''); assert.equal(ui.$('#account-password').required,false);
  ui.$('#account-code').value='123456';ui.$('#account-form').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
  await waitFor(()=>second); assert.deepEqual(second,{challengeId:'pending',code:'123456'});
  await waitFor(()=>ui.$('#account-status').textContent==='Code expired');
});

test('password reset requests email then verifies a code with the new password', async t => {
  let sent, reset;
  const ui = setup(t,(path,options)=>{
    let payload;
    if(path==='/api/auth/me')payload={user:null};
    if(path==='/api/auth/challenge')payload={provider:'disabled'};
    if(path==='/api/auth/password/request'){sent=JSON.parse(options.body);payload={resetId:'reset-id',message:'Check your email. Code expires in five minutes.'};}
    if(path==='/api/auth/password/reset'){reset=JSON.parse(options.body);payload={message:'Password updated. Sign in again.'};}
    if(payload)return{ok:true,json:async()=>payload};
  },false,'login');
  await ui.boot();ui.$('#forgot-password').click();
  await waitFor(()=>ui.calls.filter(p=>p==='/api/auth/challenge').length===2);
  await new Promise(r=>setTimeout(r,5));
  ui.$('#account-email').value='alice@example.com';ui.$('#account-form').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
  await waitFor(()=>!ui.$('#account-code-label').hidden);
  assert.equal(sent.email,'alice@example.com');assert.equal(sent.password,undefined);
  ui.$('#account-code').value='123456';ui.$('#account-password').value='new password 456';
  ui.$('#account-form').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
  await waitFor(()=>ui.$('#account-form').hidden);
  assert.deepEqual(reset,{resetId:'reset-id',code:'123456',password:'new password 456'});
});
