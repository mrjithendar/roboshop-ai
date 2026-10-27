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
function setup(t, handler = () => undefined, storefront = false, auth = false, route = 'checkout') {
  const dom = new JSDOM(auth ? authHtml : storefront ? html : checkoutHtml, { url: auth ? 'https://shop.example/' + (auth === 'login' ? 'login' : 'register') : storefront ? 'https://shop.example/' : 'https://shop.example/' + route, runScripts: 'outside-only' });
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
      '/api/cart': cart, '/api/payments/config': { enabled: true, message: 'Test payments', currencies: ['INR'] },
      '/api/auth/me': { user: { id: 'customer', name: 'Customer', email: 'customer@example.com', role: 'customer' } },
      '/api/settings': { storeName: 'RoboShop', announcement: 'Hello', supportEmail: '', checkoutEnabled: true },
      '/api/status': { assistantMode: 'catalogue-search' }, '/api/payments/current': { order: null },
      '/api/shipping/countries': { countries: [{ code: 'IN', name: 'India', cityCount: 10 }] },
      // Checkout pays only a server-signed INR quote.
      '/api/payments/quote': { cart: { ...cart, currency: 'INR' }, quoteToken: 'signed-quote', expiresAt: Math.floor(Date.now() / 1000) + 300 },
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

test('storefront filters persist in the URL and can be cleared', async t => {
  const ui = setup(t, undefined, true); await ui.boot();
  assert.equal(ui.$('#products').hasAttribute('aria-busy'), false);
  assert.equal(ui.$('#clear-filters').hidden, true);
  ui.$('#search').value = 'nothing'; ui.$('#search').dispatchEvent(new ui.w.Event('input'));
  assert.equal(new URL(ui.w.location.href).searchParams.get('q'), 'nothing');
  assert.equal(ui.$('#clear-filters').hidden, false);
  ui.$('#products .empty-state button').click();
  assert.equal(ui.$('#search').value, '');
  assert.equal(new URL(ui.w.location.href).searchParams.has('q'), false);
  assert.equal(ui.$('.product-title').textContent, product.name);
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
  ui.w.localStorage.setItem('roboshop-payment-order', 'expired');
  await ui.boot();
  await waitFor(() => ui.calls.includes('/api/payments/current'));
  assert.equal(ui.w.localStorage.getItem('roboshop-payment-order'), null);
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
  ui.w.localStorage.setItem('roboshop-payment-order', 'pending-order');
  await ui.boot();
  await waitFor(() => ui.$('#checkout-error-message').textContent.includes('Payment service unavailable'));
  assert.equal(ui.w.localStorage.getItem('roboshop-payment-order'), 'pending-order');
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
  assert.equal(ui.w.localStorage.getItem('roboshop-payment-order'),null);
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
  await ui.boot();
  assert.equal(ui.$('#forgot-password').hidden, false);
  assert.equal(ui.$('#forgot-password').type, 'button');
  assert.ok(ui.$('#account-form').contains(ui.$('#forgot-password')));
  ui.$('#forgot-password').click();
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


test('unavailable cart items render safely and can be removed before checkout', async t => {
  const unavailable = { sku: 'REMOVED', quantity: 2, unavailable: true };
  let removed = false;
  const ui = setup(t, (path, options) => {
    if (path !== '/api/cart') return;
    if (options?.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), { sku: 'REMOVED', quantity: 0 });
      removed = true;
    }
    return { ok: true, status: 200, json: async () => ({ ...cart, items: removed ? cart.items : [unavailable, ...cart.items] }) };
  });
  await ui.boot();
  assert.equal(ui.$('#checkout').disabled, true);
  const row = ui.$('.cart-unavailable');
  assert.match(row.textContent, /no longer available/);
  assert.equal(row.querySelector('a'), null);
  assert.equal(row.querySelector('img'), null);
  assert.equal(row.querySelector('.quantity-control'), null);
  assert.doesNotMatch(row.textContent, /NaN|undefined/);
  assert.equal(ui.$('#cart-items').children.length, 2);
  row.querySelector('button').click();
  await waitFor(() => !ui.$('.cart-unavailable'));
  assert.equal(removed, true);
  assert.equal(ui.$('#cart-items').children.length, 1);
  assert.equal(ui.$('#checkout').disabled, false);
});


test('cart page hides checkout navigation until unavailable items are removed', async t => {
  const ui = setup(t, path => path === '/api/cart' ? { ok: true, status: 200, json: async () => ({ ...cart, items: [{ sku: 'OLD', quantity: 1, unavailable: true }] }) } : undefined, false, false, 'cart');
  await ui.boot();
  assert.equal(ui.$('#continue-checkout').hidden, true);
  assert.equal(ui.$('.cart-unavailable button').disabled, false);
});

test('pending payments still prevent removing unavailable cart items', async t => {
  const ui = setup(t, path => {
    const value = path === '/api/cart' ? { ...cart, items: [{ sku: 'OLD', quantity: 1, unavailable: true }] }
      : path === '/api/payments/current' ? { order: { ...cart, id: 'pending', status: 'payment_pending' } } : null;
    return value ? { ok: true, status: 200, json: async () => value } : undefined;
  });
  await ui.boot();
  assert.equal(ui.$('.remove-button').disabled, true);
  assert.equal(ui.$('.cart-unavailable'), null); // Pending order renders its frozen snapshot.
  assert.equal(ui.$('#check-payment').hidden, false);
});

test('sandbox label, dismissal/resume, failure and capture preserve the original test environment', async t => {
  let options, failed, opened=0, captured=false;
  const order={...cart,id:'sandbox-order',status:'payment_pending',paymentCaptured:false,paymentMode:'test',demo:true};
  const response=value=>({ok:true,json:async()=>value});
  const ui=setup(t,path=>{
    if(path==='/api/payments/config')return response({enabled:true,mode:'live',message:'Live configuration'});
    if(path==='/api/payments/current')return response({order});
    if(path==='/api/payments/orders')return response({order,checkout:{key:'rzp_test_UI'}});
    if(path.startsWith('/api/payments/status'))return response(order);
    if(path==='/api/payments/verify'){captured=true;return response({...order,status:'paid',paymentCaptured:true,paymentId:'pay_TEST'});}
  });
  ui.w.Razorpay=class {constructor(value){options=value;} open(){opened++;} on(event,handler){failed=handler;}};
  await ui.boot();
  assert.match(ui.$('#checkout-environment').textContent,/^Test mode$/);
  assert.match(ui.$('#checkout').textContent,/Resume demo/);
  ui.$('#checkout').click();await waitFor(()=>options);
  assert.equal(options.key,'rzp_test_UI');
  await options.modal.ondismiss();
  assert.equal(ui.w.localStorage.getItem('roboshop-payment-order'),'sandbox-order');
  assert.equal(captured,false);
  ui.$('#checkout').click();await waitFor(()=>opened===2);
  failed();assert.match(ui.$('#order-result').textContent,/not confirmed/);
  await options.handler({razorpay_order_id:'order_TEST',razorpay_payment_id:'pay_TEST',razorpay_signature:'unit'});
  assert.match(ui.$('#confirmation-details').textContent,/no real money charged; no delivery/);
  assert.match(ui.$('#checkout-environment').textContent,/^Test mode$/);
  assert.doesNotMatch(ui.$('#payment-notice').textContent,/Live/);
  assert.equal(ui.w.localStorage.getItem('roboshop-payment-order'),null);
});

test('storefront separates reference and demo collections and keeps provenance labels',async t=>{
 const reference={...product,sku:'REF-TEST',collection:'reference',manufacturer:'Pololu',currency:'USD',priceType:'reference',showcase:true,instock:0,image:'/images/placeholder.png'};
 const demo={...product,sku:'DEMO',collection:'demo',demo:true};
 const ui=setup(t,async path=>path==='/api/products'?{ok:true,json:async()=>({products:[reference,demo]})}:undefined,true);await ui.boot();
 ui.$('#collection-filter').value='reference';ui.$('#collection-filter').dispatchEvent(new ui.w.Event('change'));
 assert.equal(ui.w.document.querySelectorAll('#products .product-card').length,1);
 assert.match(ui.$('#products').textContent,/reference price, not a store offer/);
 assert.match(ui.$('#products').textContent,/not a product photo/);
 ui.$('#collection-filter').value='demo';ui.$('#collection-filter').dispatchEvent(new ui.w.Event('change'));
 assert.match(ui.$('#products').textContent,/demo price/);assert.match(ui.$('#products').textContent,/SIMULATED/);
});

test('checkout quotes and pays only in INR, sending just the signed quote to the provider order route', async t => {
  let requestBody, providerOptions, quoted;
  const inr = {...cart,currency:'INR',subtotal:1200,total:1300,shipping:{...cart.shipping,cost:100},items:cart.items.map(p=>({...p,currency:'INR',price:1200,lineTotal:1200}))};
  const ui=setup(t,(path,options)=>{
    const reply=body=>({ok:true,json:async()=>body});
    // Another currency offered by the server or saved by the shopper is never used for payment.
    if(path==='/api/payments/config')return reply({enabled:true,currencies:['INR','GBP']});
    if(path==='/api/payments/quote') {quoted=JSON.parse(options.body).currency;return reply({cart:inr,quoteToken:'server-signed-quote',expiresAt:Math.floor(Date.now()/1000)+300});}
    if(path==='/api/payments/orders') {requestBody=JSON.parse(options.body);return reply({order:{...inr,id:'inr-order',status:'payment_pending'},checkout:{currency:'INR',amount:130000}});}
  });
  ui.w.localStorage.setItem('roboshop.displayCurrency','GBP');
  ui.w.Razorpay=class {constructor(options){providerOptions=options;}open(){}on(){}};
  await ui.boot();
  assert.equal(quoted,'INR');assert.match(ui.$('#cart-total').textContent,/₹1,300\.00/);
  assert.equal(ui.$('#display-currency').value,'INR');assert.equal(ui.$('#display-currency').disabled,true);
  ui.$('#checkout').click();await waitFor(()=>providerOptions);
  assert.deepEqual(requestBody,{quoteToken:'server-signed-quote'});assert.equal(providerOptions.currency,'INR');assert.equal(providerOptions.amount,130000);
});

test('expired currency quote refreshes for review without creating a provider order', async t => {
 let quotes=0, orders=0;
 const ui=setup(t,path=>{
  const reply=body=>({ok:true,json:async()=>body});
  if(path==='/api/payments/config')return reply({enabled:true,currencies:['INR']});
  if(path==='/api/payments/quote')return reply({cart:{...cart,currency:'INR'},quoteToken:'quote-'+(++quotes),expiresAt:Math.floor(Date.now()/1000)+(quotes===1?-1:300)});
  if(path==='/api/payments/orders'){orders++;return reply({});}
 });
 await ui.boot();ui.$('#checkout').click();await waitFor(()=>ui.$('#order-result').textContent.includes('Review it'));
 assert.equal(quotes,2);assert.equal(orders,0);
});

test('guest cart shows an INR estimate despite a saved USD preference and requests no payment quote',async t=>{
 const original={...cart,currency:'INR',subtotal:1200,total:1500,shipping:{...cart.shipping,cost:300},items:[{...product,currency:'INR',price:1200,lineTotal:1200,quantity:1}]};
 const ui=setup(t,path=>{
   const reply=body=>({ok:true,json:async()=>body});
   if(path==='/api/auth/me')return reply({user:null});
   if(path==='/api/cart')return reply(original);
   if(path==='/api/payments/config')return reply({enabled:true,currencies:['INR','USD','GBP']});
   if(path.startsWith('/api/currency/rates'))return reply({displayOnly:true,asOf:new Date().toISOString().slice(0,10),suggestedCurrency:'USD',rates:{INR:100,USD:1,GBP:0.8}});
 },false,false,'cart');
 ui.w.localStorage.setItem('roboshop.displayCurrency','USD');
 await ui.boot();
 assert.equal(ui.$('#display-currency').value,'INR');
 assert.equal(ui.$('#display-currency').disabled,true);
 assert.match(ui.$('#cart-total').textContent,/₹1,500\.00/);
 assert.match(ui.$('#currency-status').textContent,/only in INR.*Estimated cart total in INR/);
 assert.ok(!ui.calls.includes('/api/payments/quote'));
});

test('signed-in cart obtains an authoritative INR quote even when the region suggests USD',async t=>{
 let requested;
 const ui=setup(t,(path,options)=>{
   const reply=body=>({ok:true,json:async()=>body});
   if(path==='/api/cart')return reply({...cart,currency:'INR'});
   if(path==='/api/payments/config')return reply({enabled:true,currencies:['INR','USD']});
   if(path.startsWith('/api/currency/rates'))return reply({displayOnly:true,asOf:new Date().toISOString().slice(0,10),suggestedCurrency:'USD',rates:{INR:100,USD:1}});
   if(path==='/api/payments/quote'){requested=JSON.parse(options.body).currency;return reply({cart:{...cart,currency:'INR',total:16},quoteToken:'signed',expiresAt:Math.floor(Date.now()/1000)+300});}
 },false,false,'cart');
 await ui.boot();assert.equal(requested,'INR');assert.match(ui.$('#cart-total').textContent,/₹16\.00/);
});

test('guest FX failure keeps original amount and explains why conversion is unavailable',async t=>{
 const ui=setup(t,path=>{
  const reply=body=>({ok:true,json:async()=>body});
  if(path==='/api/auth/me')return reply({user:null});
  if(path==='/api/cart')return reply({...cart,currency:'INR'});
  if(path==='/api/payments/config')return reply({enabled:true,currencies:['INR','USD']});
  if(path.startsWith('/api/currency/rates'))throw new Error('offline');
 },false,false,'cart');
 ui.w.localStorage.setItem('roboshop.displayCurrency','USD');
 await ui.boot();assert.match(ui.$('#cart-total').textContent,/₹15\.00/);
 assert.match(ui.$('#currency-status').textContent,/conversion unavailable.*INR/);
});

test('reserved INR checkout stays fixed despite a saved USD preference',async t=>{
 const reserved={...cart,currency:'INR',id:'reserved-order',status:'payment_pending',paymentCaptured:false,paymentMode:'test'};
 const ui=setup(t,path=>{
  const reply=body=>({ok:true,json:async()=>body});
  if(path==='/api/cart')return reply({...cart,currency:'INR'});
  if(path==='/api/payments/config')return reply({enabled:true,currencies:['INR','USD']});
  if(path==='/api/payments/current')return reply({order:reserved});
 },false,false,'cart');
 ui.w.localStorage.setItem('roboshop.displayCurrency','USD');
 await ui.boot();assert.equal(ui.$('#display-currency').value,'INR');
 assert.equal(ui.$('#display-currency').disabled,true);
 assert.match(ui.$('#currency-status').textContent,/already reserved/);
 assert.ok(!ui.calls.includes('/api/payments/quote'));
 assert.match(ui.$('#cart-total').textContent,/₹15\.00/);
});
