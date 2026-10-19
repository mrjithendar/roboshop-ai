import { appPath, productImage, canPurchase } from './paths.js';
import { currentUser, initAccount, showLogin } from './account.js';
export {};

// ID selectors carry their actual DOM type; a missing element fails at startup.
type Controls = {
  '#search': HTMLInputElement; '#in-stock': HTMLInputElement; '#sort': HTMLSelectElement;
  '#shipping-fields': HTMLFieldSetElement; '#checkout': HTMLButtonElement;
  '#send-message': HTMLButtonElement; '#message': HTMLTextAreaElement;
  '#shipping-country': HTMLSelectElement; '#shipping-city': HTMLSelectElement;
  '#shipping-search': HTMLInputElement; '#shipping-recipient': HTMLInputElement;
  '#shipping-address': HTMLInputElement; '#shipping-postcode': HTMLInputElement;
  '#cart-dialog': HTMLDialogElement;
};
function $<K extends string>(selector: K): K extends keyof Controls ? Controls[K] : HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing UI element: ${selector}`);
  return node as K extends keyof Controls ? Controls[K] : HTMLElement;
}
interface Product { slug?: string; currency?: string; priceType?: string; showcase?: boolean; synthetic?: boolean; productType?: string; sku: string; name: string; description: string; image: string; price: number; instock: number; categories: string[] }
interface CartItem extends Product { quantity: number; lineTotal: number }
interface Shipping { address: { recipient: string; line1: string }; city: { name: string; country: string }; cost: number; distanceKm: number; quotedAt: string }
interface Cart { items: CartItem[]; total: number; subtotal?: number; shipping?: Shipping | null }
interface Order extends Cart { id: string; status: 'creating' | 'payment_pending' | 'payment_review' | 'paid'; paymentCaptured: boolean; paymentId?: string }
interface PaymentConfig { enabled: boolean; message?: string }
interface CheckoutOptions { key: string; order_id: string; amount: number; currency: string; name: string; description: string }
interface CheckoutResponse { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface RazorpayInstance { open(): void; on(event: 'payment.failed', handler: () => void): void }
declare global { interface Window { Razorpay?: new (options: CheckoutOptions & { handler(response: CheckoutResponse): Promise<void>; modal: { ondismiss(): Promise<void> } }) => RazorpayInstance } }
interface Country { code: string; name: string; cityCount: number }
interface City { id: number; name: string; region?: string }
interface Ops { summary: string; services: { name: string; status: string; latencyMs: number }[]; nextSteps: string[]; checkedAt: string }
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const money = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
let products: Product[] = [], cart: Cart = { items: [], total: 0 }, category = '', chatBusy = false, cartBusy = false;
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
function show(id: string) { const dialog = document.getElementById(id); if (!(dialog instanceof HTMLDialogElement)) throw new Error(`Missing dialog: ${id}`); if (!dialog.open) dialog.showModal(); }
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.addEventListener('click', () => { const dialog = document.getElementById(button.dataset.close || ''); if (dialog instanceof HTMLDialogElement) dialog.close(); }));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
function image(p: Product, className = '') { const img = el('img', className); img.src = productImage(p); img.alt = p.name; img.loading = 'lazy'; img.addEventListener('error', () => { img.src = productImage({ image: '', productType: p.productType }); }, { once: true }); return img; }
function productPrice(p: Product) { return p.priceType === 'on-request' ? 'Price on request' : new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'EUR' }).format(p.price) + (p.showcase ? ' · reference' : ''); }
const canBuy = canPurchase;
function addButton(p: Product) {
  const button = el('button', 'add-button', canBuy(p) ? 'Add to cart' : 'View details');
  if (!canBuy(p)) { button.setAttribute('aria-label', `View ${p.name} showcase details`); button.addEventListener('click', () => detail(p)); return button; } button.setAttribute('aria-label', `Add ${p.name} to bag`); button.disabled = p.instock < 1;
  button.addEventListener('click', async () => { button.disabled = true; await add(p); button.disabled = p.instock < 1; }); return button;
}
function card(p: Product) {
  const article = el('article', 'product-card');
  const visual = el('a', 'product-image-button'); visual.href = appPath(`/products/${encodeURIComponent(p.slug || p.sku.toLowerCase())}`); visual.setAttribute('aria-label', `View ${p.name}`); visual.append(image(p), el('span', 'product-badge', p.showcase ? 'SHOWCASE' : p.instock > 0 ? 'AVAILABLE' : 'OUT OF STOCK'));
  const title = el('a', 'product-title', p.name); title.href = visual.href;
  const bottom = el('div', 'product-bottom'); bottom.append(el('span', 'product-price', productPrice(p)), addButton(p));
  article.append(visual, el('p', 'product-category', [p.productType, ...p.categories].filter(Boolean).join(' / ')), title, el('p', 'product-description', p.description), bottom);
  return article;
}
function renderProducts() {
  const query = $('#search').value.toLowerCase().trim();
  let visible = products.filter(p => (!category || p.categories.includes(category)) && (!$('#in-stock').checked || p.instock > 0) && `${p.name} ${p.description} ${p.categories.join(' ')}`.toLowerCase().includes(query));
  const sort = $('#sort').value;
  visible.sort(sort === 'price-low' ? (a, b) => (a.currency || 'EUR').localeCompare(b.currency || 'EUR') || Number(a.priceType === 'on-request') - Number(b.priceType === 'on-request') || a.price - b.price : sort === 'price-high' ? (a, b) => (a.currency || 'EUR').localeCompare(b.currency || 'EUR') || Number(a.priceType === 'on-request') - Number(b.priceType === 'on-request') || b.price - a.price : sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => Number(b.image.startsWith('/product-media/')) - Number(a.image.startsWith('/product-media/')));
  $('#products').replaceChildren(...visible.map(card));
  if (!visible.length) $('#products').append(el('p', 'empty-state', 'No robots match just yet. Try another search or category.'));
  $('#result-count').textContent = `${visible.length} robotics product${visible.length === 1 ? '' : 's'}`;
  $('#product-count').textContent = String(products.length);
}
async function loadProducts() {
  $('#catalogue-error').hidden = true;
  try { products = (await api<{ products: Product[] }>('/api/products')).products; renderProducts(); }
  catch { $('#products').replaceChildren(); $('#catalogue-error').hidden = false; $('#result-count').textContent = 'Collection unavailable'; }
}
async function loadRecommendations() {
  try { $('#recommendations').replaceChildren(...(await api<{ products: Product[] }>('/api/recommendations')).products.map(card)); }
  catch { $('#recommendations').replaceChildren(el('p', 'empty-state', 'Recommendations are unavailable right now. Explore the collection above.')); }
}
$('#retry-products').addEventListener('click', loadProducts);
$('#search').addEventListener('input', renderProducts); $('#sort').addEventListener('change', renderProducts); $('#in-stock').addEventListener('change', renderProducts);
document.querySelectorAll<HTMLElement>('[data-category]').forEach(button => button.addEventListener('click', () => { category = button.dataset.category || ''; document.querySelectorAll<HTMLElement>('[data-category]').forEach(tab => { const active = tab === button; tab.classList.toggle('selected', active); tab.setAttribute('aria-pressed', String(active)); }); renderProducts(); }));
function detail(p: Product) { location.href = appPath(`/products/${encodeURIComponent(p.slug || p.sku.toLowerCase())}`); }

async function add(p: Product) { const quantity = (cart.items.find(item => item.sku === p.sku)?.quantity || 0) + 1; if (await updateCart(p.sku, quantity)) toast(`${p.name} is in your bag.`); }
async function updateCart(sku: string, quantity: number) {
  if (cartBusy) return false;
  cartBusy = true;
  try { cart = await api<Cart>('/api/cart', { method: 'POST', body: JSON.stringify({ sku, quantity }) }); checkoutKey = null; $('#order-result').textContent = ''; renderCart(); return true; }
  catch (error) { toast(errorMessage(error)); return false; }
  finally { cartBusy = false; renderCart(); }
}
function renderCart() {
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
    info.append(el('h3', '', p.name), el('p', '', money(p.lineTotal)), qty); row.append(image(p), info, remove); return row;
  });
  $('#cart-items').replaceChildren(...(rows.length ? rows : [el('p', 'empty-state', 'Your next companion is waiting. Explore the collection to fill your bag.')]));
}
async function paymentResult(order: Order | null) {
  if (order?.status === 'paid' && order.paymentCaptured) {
    pendingOrder = null; checkoutKey = null; paymentReference(null);
    $('#order-result').textContent = `Payment confirmed. Order ${order.id.slice(0, 8)} · ${money(order.total)}. Reference: ${order.paymentId}`;
    cart = await api<Cart>('/api/cart'); renderCart(); await Promise.all([loadProducts(), loadRecommendations()]);
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
$('#bag-button').addEventListener('click', async () => {
  show('cart-dialog');
  loadShipping().catch(error => $('#shipping-status').textContent = errorMessage(error));
  try { await loadPaymentConfig(); await checkPayment(); cart = await api<Cart>('/api/cart'); renderCart(); }
  catch (error) { $('#order-result').textContent = errorMessage(error); }
});
$('#check-payment').addEventListener('click', async () => { try { await checkPayment(); } catch (error) { $('#order-result').textContent = errorMessage(error); } });
$('#checkout').addEventListener('click', async () => {
  if (!currentUser) { showLogin(); return; }
  if (cartBusy || !paymentConfig.enabled) return;
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
        show('cart-dialog'); $('#order-result').textContent = 'Verifying payment with Razorpay…';
        try { await paymentResult(await api<Order>('/api/payments/verify', { method: 'POST', body: JSON.stringify({ orderId: result.order.id, ...response }) })); }
        catch { $('#order-result').textContent = 'Payment verification is pending. Check payment status before making another payment.'; }
        finally { cartBusy = false; renderCart(); }
      },
      modal: { ondismiss: async () => {
        cartBusy = false; show('cart-dialog'); renderCart();
        try { await checkPayment(); } catch (error) { $('#order-result').textContent = errorMessage(error); }
      } },
    });
    checkout.on('payment.failed', () => { $('#order-result').textContent = 'Payment was not confirmed. You can retry within Razorpay or check payment status.'; });
    $('#cart-dialog').close(); checkout.open();
  } catch (error) { $('#order-result').textContent = errorMessage(error); show('cart-dialog'); }
  finally { cartBusy = false; renderCart(); }
});
for (const id of ['ask-nav', 'hero-assistant', 'banner-assistant', 'assistant-launcher']) $(`#${id}`).addEventListener('click', () => { show('assistant-dialog'); $('#message').focus(); });
function chatMessage(role: 'user' | 'assistant', content: string) { const node = el('div', `chat-message ${role}`); node.append(el('span', 'message-label', role === 'user' ? 'YOU' : 'ROBOTSHOP ASSISTANT'), el('p', '', content)); $('#chat-messages').append(node); node.scrollIntoView({ block: 'nearest' }); return node; }
async function chat(message: string) {
  if (chatBusy || !message.trim()) return;
  chatBusy = true; $('#send-message').disabled = true; $('#message').value = ''; chatMessage('user', message);
  const pending = chatMessage('assistant', 'Finding your match…');
  try {
    const result = await api<{ answer: string; notice: string; products: Product[]; requestId?: string }>('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });
    pending.querySelector('p')!.textContent = result.answer; $('#assistant-mode').textContent = result.notice + (result.requestId ? ` (Request ${result.requestId})` : '');
    for (const p of result.products) { const row = el('div', 'chat-product'), info = el('div'); info.append(el('strong', '', p.name), el('span', '', productPrice(p))); row.append(image(p), info, addButton(p)); pending.append(row); }
  } catch (error) { pending.querySelector('p')!.textContent = errorMessage(error); }
  finally { chatBusy = false; $('#send-message').disabled = false; $('#message').focus(); pending.scrollIntoView({ block: 'nearest' }); }
}
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); chat($('#message').value); });
$('#message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); chat($('#message').value); } });
document.querySelectorAll<HTMLElement>('[data-prompt]').forEach(button => button.addEventListener('click', () => chat(button.dataset.prompt || '')));
async function loadOps() {
  $('#ops-content').replaceChildren(el('p', '', 'Checking services…'));
  try {
    const result = await api<Ops>('/api/ops');
    const nodes: HTMLElement[] = [el('p', '', result.summary)];
    for (const service of result.services) { const row = el('div', 'health-row'); row.append(el('span', '', service.name), el('span', service.status === 'healthy' ? 'healthy' : 'unavailable', `${service.status} · ${service.latencyMs} ms`)); nodes.push(row); }
    const steps = el('ul'); for (const step of result.nextSteps) steps.append(el('li', '', step)); nodes.push(steps, el('p', '', `Checked ${new Date(result.checkedAt).toLocaleTimeString()}. No infrastructure actions executed.`)); $('#ops-content').replaceChildren(...nodes);
  } catch (error) { $('#ops-content').replaceChildren(el('p', '', errorMessage(error))); }
}
$('#ops-button').addEventListener('click', () => { show('ops-dialog'); loadOps(); }); $('#refresh-ops').addEventListener('click', loadOps);

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

await initAccount(async () => {
  pendingOrder = null; checkoutKey = null; paymentReference(null);
  cart = await api<Cart>('/api/cart'); renderCart();
  await checkPayment();
});
await api<{ storeName: string; announcement: string; supportEmail: string; checkoutEnabled: boolean }>('/api/settings').then(settings => {
  document.title = settings.storeName;
  document.querySelectorAll<HTMLAnchorElement>('.wordmark').forEach(brand => { brand.textContent = settings.storeName; brand.setAttribute('aria-label', `${settings.storeName} home`); });
  const announcement = document.querySelector('.announcement span'); if (announcement) announcement.textContent = settings.announcement;
  const footer = document.querySelector('footer p'); if (footer && settings.supportEmail) footer.textContent = `Contact: ${settings.supportEmail}`;
}).catch(() => {});
await Promise.all([loadPaymentConfig(), loadProducts(), loadRecommendations(), api<Cart>('/api/cart').then(result => { cart = result; renderCart(); }).catch(() => toast('Your bag could not be loaded. Please try again.')), api<{ assistantMode: string }>('/api/status').then(result => { $('#assistant-mode').textContent = result.assistantMode === 'ai' ? 'AI assistant connected · grounded in the catalogue' : 'Please connect an LLM to get AI recommendations.'; }).catch(() => {})]);

if (new URLSearchParams(location.search).get('cart') === '1') show('cart-dialog');
