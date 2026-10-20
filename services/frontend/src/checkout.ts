import { appPath, productImage } from './paths.js';
import { currentUser, initAccount, showLogin } from './account.js';
export {};

// ID selectors carry their actual DOM type; a missing element fails at startup.
type Controls = {
  '#shipping-fields': HTMLFieldSetElement; '#checkout': HTMLButtonElement;
  '#shipping-country': HTMLSelectElement; '#shipping-city': HTMLSelectElement;
  '#shipping-search': HTMLInputElement; '#shipping-recipient': HTMLInputElement;
  '#shipping-address': HTMLInputElement; '#shipping-postcode': HTMLInputElement;

};
function $<K extends string>(selector: K): K extends keyof Controls ? Controls[K] : HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing UI element: ${selector}`);
  return node as K extends keyof Controls ? Controls[K] : HTMLElement;
}
interface Product { slug?: string; currency?: string; priceType?: string; showcase?: boolean; synthetic?: boolean; productType?: string; sku: string; name: string; description: string; image: string; price: number; instock: number; categories: string[] }
interface CartItem extends Product { quantity: number; lineTotal: number }
interface Shipping { address: { recipient: string; line1: string; postalCode?: string }; city: { id?: number; name: string; country: string; countryCode?: string }; cost: number; distanceKm: number; quotedAt: string }
interface Cart { currency?: string; items: CartItem[]; total: number; subtotal?: number; shipping?: Shipping | null }
interface Order extends Cart { id: string; status: 'creating' | 'payment_pending' | 'payment_review' | 'paid'; paymentCaptured: boolean; paymentId?: string }
interface PaymentConfig { enabled: boolean; message?: string }
interface CheckoutOptions { key: string; order_id: string; amount: number; currency: string; name: string; description: string }
interface CheckoutResponse { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface RazorpayInstance { open(): void; on(event: 'payment.failed', handler: () => void): void }
declare global { interface Window { Razorpay?: new (options: CheckoutOptions & { handler(response: CheckoutResponse): Promise<void>; modal: { ondismiss(): Promise<void> } }) => RazorpayInstance } }
interface Country { code: string; name: string; cityCount: number }
interface City { id: number; name: string; region?: string }
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const money = (value: number, currency = cart.currency || 'EUR') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
let cart: Cart = { items: [], total: 0 }, cartBusy = false;
let checkoutKey: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined, citySearchTimer: ReturnType<typeof setTimeout> | undefined;
let shippingDirty = false, citySearchVersion = 0;
let paymentConfig: PaymentConfig = { enabled: false };
let pendingOrder: Order | null = null, checkoutScript: Promise<void> | null = null;
function paymentReference(value?: string | null) { try { if (value === undefined) return localStorage.getItem('robotshop-payment-order'); if (value) localStorage.setItem('robotshop-payment-order', value); else localStorage.removeItem('robotshop-payment-order'); } catch {} }
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; };
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(appPath(path), { ...options, headers: { 'content-type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(25000) });
  let result;
  try { result = await response.json(); } catch { throw new Error('The service is unavailable. Please try again.'); }
  if (!response.ok) throw new ApiError(result.error || 'The request could not be completed.', response.status);
  return result;
}
function toast(message: string) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.addEventListener('click', () => { const dialog = document.getElementById(button.dataset.close || ''); if (dialog instanceof HTMLDialogElement) dialog.close(); }));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
function image(p: Product, className = '') { const img = el('img', className); img.src = productImage(p); img.alt = p.name; img.loading = 'lazy'; img.addEventListener('error', () => { img.src = productImage({ image: '', productType: p.productType }); }, { once: true }); return img; }
const isCartPage = location.pathname.replace(/\/$/, '').endsWith('/cart');
document.body.classList.toggle('cart-page', isCartPage);
$('#checkout-title').textContent = isCartPage ? 'Your cart' : 'Checkout';
document.title = isCartPage ? 'Your cart · RobotShop' : 'Checkout · RobotShop';
$('#step-cart').setAttribute('aria-current', isCartPage ? 'step' : 'false');
$('#step-checkout').setAttribute('aria-current', isCartPage ? 'false' : 'step');
async function updateCart(sku: string, quantity: number) {
  if (cartBusy) return false;
  cartBusy = true;
  try { cart = await api<Cart>('/api/cart', { method: 'POST', body: JSON.stringify({ sku, quantity }) }); checkoutKey = null; $('#order-result').textContent = ''; $('#confirmation').hidden = true; renderCart(); return true; }
  catch (error) { toast(errorMessage(error)); return false; }
  finally { cartBusy = false; renderCart(); }
}
function renderCart() {
  $('#continue-checkout').hidden = !cart.items.length || !isCartPage;
  $('#checkout-empty').hidden = Boolean(cart.items.length) || !$('#confirmation').hidden;
  $('#checkout-columns').hidden = !cart.items.length;
  $('#delivery-panel').hidden = isCartPage || !cart.items.length;
  $('#payment-panel').hidden = isCartPage || !cart.items.length;
  $('#checkout-account').textContent = currentUser ? `Signed in as ${currentUser.email}` : 'Sign in to complete your purchase. Your cart will be kept.';
  $('#bag-count').textContent = String(cart.items.reduce((n, item) => n + item.quantity, 0));
  if (cart.shipping && !shippingDirty) $('#shipping-status').textContent = `${cart.shipping.address.recipient} · ${cart.shipping.address.line1} · ${cart.shipping.city.name}, ${cart.shipping.city.country} · ${money(cart.shipping.cost)} shipping. Edit below to change your destination.`;
  $('#cart-subtotal').textContent = money(cart.subtotal || 0);
  $('#cart-shipping').textContent = cart.shipping ? money(cart.shipping.cost) : 'Not calculated';
  $('#shipping-fields').disabled = Boolean(pendingOrder) || cartBusy;
  $('#cart-total').textContent = money(cart.total); $('#checkout').disabled = cartBusy || !currentUser && !cart.items.length || Boolean(currentUser) && ( !paymentConfig.enabled || !cart.items.length || (!pendingOrder && (!cart.shipping || shippingDirty)) || ['creating', 'payment_review'].includes(pendingOrder?.status || ''));
  $('#checkout').textContent = !currentUser ? 'Log in to checkout' : pendingOrder?.status === 'payment_pending' ? 'Resume secure payment ↗' : 'Pay securely ↗';
  $('#check-payment').hidden = !pendingOrder;
  const rows = cart.items.map(p => {
    const row = el('div', 'cart-row'), info = el('div'), qty = el('div', 'quantity-control');
    for (const [symbol, quantity, label] of [['−', p.quantity - 1, 'Decrease'], ['+', p.quantity + 1, 'Increase']] as const) {
      const button = el('button', '', symbol); button.setAttribute('aria-label', `${label} ${p.name} quantity`); button.addEventListener('click', () => updateCart(p.sku, quantity));
      if (symbol === '+') { qty.append(el('span', '', String(p.quantity))); button.disabled = p.quantity >= Math.min(p.instock, 20); } qty.append(button);
    }
    const remove = el('button', 'remove-button', 'Remove'); remove.addEventListener('click', () => updateCart(p.sku, 0));
    if (pendingOrder) { qty.querySelectorAll('button').forEach(button => button.disabled = true); remove.disabled = true; }
    const href = appPath('/products/' + encodeURIComponent(p.slug || p.sku.toLowerCase()));
    const title = el('h3'), productLink = el('a', 'cart-product-link', p.name); productLink.href = href; title.append(productLink);
    const imageLink = el('a', 'cart-product-image'); imageLink.href = href; imageLink.setAttribute('aria-label', `View ${p.name}`); imageLink.append(image(p));
    info.append(title, el('p', '', money(p.lineTotal)), qty); row.append(imageLink, info, remove); return row;
  });
  $('#cart-items').replaceChildren(...(rows.length ? rows : [el('p', 'empty-state', 'Your next companion is waiting. Explore the collection to fill your bag.')]));
}
async function paymentResult(order: Order | null) {
  if (order?.status === 'paid' && order.paymentCaptured) {
    pendingOrder = null; checkoutKey = null; paymentReference(null);
    $('#order-result').textContent = `Payment confirmed. Order ${order.id.slice(0, 8)} · ${money(order.total, order.currency)}. Reference: ${order.paymentId}`;
    cart = await api<Cart>('/api/cart'); renderCart(); $('#step-checkout').setAttribute('aria-current', 'false'); $('#step-confirmation').setAttribute('aria-current', 'step'); $('#confirmation').hidden = false; $('#confirmation-details').textContent = $('#order-result').textContent; $('#checkout-empty').hidden = true; $('#confirmation').focus();
  } else if (order) {
    pendingOrder = order; paymentReference(order.id);
    $('#order-result').textContent = order.status === 'payment_review' || order.status === 'creating'
      ? `Payment setup needs review. Contact the store with order ${order.id}. Do not submit another payment.`
      : 'Payment is not confirmed yet. Resume checkout or check payment status. Your bag and stock reservation are preserved.';
    renderCart();
  }
}
async function checkPayment() {
  if (!currentUser) return;
  const id = pendingOrder?.id || paymentReference();
  if (id) {
    try { await paymentResult(await api<Order>(`/api/payments/status?orderId=${encodeURIComponent(id)}`)); return; }
    catch (error) {
      // A browser reference can outlive its session. Never discard it on a network failure.
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      pendingOrder = null; paymentReference(null);
      $('#order-result').textContent = `Order ${id} is unavailable in this browser session. If you attempted payment, contact the store with this reference before paying again.`;
    }
  }
  const result = await api<{ order: Order | null }>('/api/payments/current');
  if (result.order) await paymentResult(result.order);
}
async function loadPaymentConfig() {
  try { paymentConfig = await api<PaymentConfig>('/api/payments/config'); $('#payment-notice').textContent = paymentConfig.message || ''; }
  catch { paymentConfig = { enabled: false }; $('#payment-notice').textContent = 'Payments are unavailable. Please try again later.'; }
  renderCart();
}
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) checkoutScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timer); script.remove(); checkoutScript = null; reject(new Error('Payment checkout could not load. Please try again.')); };
    const timer = setTimeout(fail, 15000);
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
    script.onload = () => { if (!window.Razorpay) return fail(); clearTimeout(timer); resolve(); };
    script.onerror = fail;
    document.head.append(script);
  });
  return checkoutScript;
}

$('#check-payment').addEventListener('click', async () => { try { await checkPayment(); } catch (error) { $('#order-result').textContent = errorMessage(error); } });
$('#checkout').addEventListener('click', async () => {
  if (!currentUser) { showLogin(); return; }
  if (isCartPage || cartBusy || !paymentConfig.enabled || !cart.items.length || (!pendingOrder && (!cart.shipping || shippingDirty))) return;
  cartBusy = true; renderCart(); checkoutKey ||= crypto.randomUUID();
  try {
    await loadCheckout();
    const result = await api<{ order: Order; checkout: CheckoutOptions }>('/api/payments/orders', { method: 'POST', headers: { 'idempotency-key': checkoutKey }, body: '{}' });
    if (result.order.status === 'paid') { await paymentResult(result.order); return; }
    pendingOrder = result.order; paymentReference(result.order.id);
    const Razorpay = window.Razorpay;
    if (!Razorpay) throw new Error('Payment checkout could not load.');
    const checkout = new Razorpay({ ...result.checkout,
      handler: async response => {
         $('#order-result').textContent = 'Verifying payment with Razorpay…';
        try { await paymentResult(await api<Order>('/api/payments/verify', { method: 'POST', body: JSON.stringify({ orderId: result.order.id, ...response }) })); }
        catch { $('#order-result').textContent = 'Payment verification is pending. Check payment status before making another payment.'; }
        finally { cartBusy = false; renderCart(); }
      },
      modal: { ondismiss: async () => {
        cartBusy = false;  renderCart();
        try { await checkPayment(); } catch (error) { $('#order-result').textContent = errorMessage(error); }
      } },
    });
    checkout.on('payment.failed', () => { $('#order-result').textContent = 'Payment was not confirmed. You can retry within Razorpay or check payment status.'; });
    checkout.open();
  } catch (error) { $('#order-result').textContent = errorMessage(error);  }
  finally { cartBusy = false; renderCart(); }
});
async function loadShipping() {
  if ($('#shipping-country').options.length > 1) return;
  const result = await api<{ countries: Country[] }>('/api/shipping/countries');
  for (const country of result.countries) {
    const option = el('option', '', country.name + (country.cityCount ? '' : ' (no cities in dataset)'));
    option.value = country.code; option.disabled = !country.cityCount; $('#shipping-country').append(option);
  }
}
$('#shipping-form').addEventListener('input', () => { shippingDirty = true; renderCart(); });
$('#shipping-country').addEventListener('change', () => {
  citySearchVersion++; clearTimeout(citySearchTimer); $('#shipping-search').value = '';
  $('#shipping-city').replaceChildren(new Option('Select a search result', ''));
});
$('#shipping-search').addEventListener('input', () => {
  const version = ++citySearchVersion; clearTimeout(citySearchTimer);
  $('#shipping-city').replaceChildren(new Option('Select a search result', ''));
  const query = $('#shipping-search').value.trim(), country = $('#shipping-country').value;
  if (query.length < 2 || !country) return;
  citySearchTimer = setTimeout(async () => {
    try {
      const result = await api<{ cities: City[] }>('/api/shipping/cities?' + new URLSearchParams({ country, q: query }));
      if (version !== citySearchVersion) return;
      for (const city of result.cities) $('#shipping-city').append(new Option(`${city.name} · ${city.region || country}`, String(city.id)));
      $('#shipping-status').textContent = result.cities.length ? 'Select your city and enter your delivery address.' : 'No matching cities. Try another spelling. Only destinations listed in the dataset are supported.';
    } catch (error) { if (version === citySearchVersion) $('#shipping-status').textContent = errorMessage(error); }
  }, 300);
});
$('#shipping-form').addEventListener('submit', async event => {
  event.preventDefault(); if (cartBusy || pendingOrder) return;
  cartBusy = true; renderCart();
  try {
    cart = await api<Cart>('/api/shipping/quote', { method: 'POST', body: JSON.stringify({ cityId: Number($('#shipping-city').value), recipient: $('#shipping-recipient').value, line1: $('#shipping-address').value, postalCode: $('#shipping-postcode').value }) });
    shippingDirty = false; checkoutKey = null;
    $('#shipping-status').textContent = cart.shipping ? `${cart.shipping.city.name}, ${cart.shipping.city.country} · ${cart.shipping.distanceKm.toLocaleString()} km · ${money(cart.shipping.cost)} shipping. Quote valid for 24 hours.` : 'Add an item to your bag to see your shipping total.';
  } catch (error) { $('#shipping-status').textContent = errorMessage(error); }
  finally { cartBusy = false; renderCart(); }
});


async function refreshCheckout() {
  cartBusy = true; renderCart();
  try {
    cart = await api<Cart>('/api/cart');
    await loadPaymentConfig();
    await checkPayment();
    if (!isCartPage) {
      await loadShipping();
      if (cart.shipping && !shippingDirty) {
        const {address, city} = cart.shipping;
        $('#shipping-recipient').value = address.recipient;
        $('#shipping-address').value = address.line1;
        $('#shipping-postcode').value = address.postalCode || '';
        $('#shipping-country').value = city.countryCode || '';
        $('#shipping-search').value = city.name;
        if (city.id) $('#shipping-city').replaceChildren(new Option(city.name, String(city.id), true, true));
      }
    }
    $('#checkout-error').hidden = true;
  } catch (error) {
    $('#checkout-error').hidden = false;
    $('#checkout-error-message').textContent = errorMessage(error);
    // Reconcile existing payments before allowing another attempt.
    paymentConfig.enabled = false;
  } finally { cartBusy = false; renderCart(); }
}
$('#retry-checkout').addEventListener('click', refreshCheckout);
await initAccount(async () => {
  pendingOrder = null; checkoutKey = null; paymentReference(null);
  await refreshCheckout();
});
await refreshCheckout();
