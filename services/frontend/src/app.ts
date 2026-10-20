import { appPath, productImage, canPurchase } from './paths.js';
import { initAccount } from './account.js';
export {};

// ID selectors carry their actual DOM type; a missing element fails at startup.
type Controls = {
  '#search': HTMLInputElement; '#in-stock': HTMLInputElement; '#sort': HTMLSelectElement;
  '#send-message': HTMLButtonElement; '#message': HTMLTextAreaElement;
};
function $<K extends string>(selector: K): K extends keyof Controls ? Controls[K] : HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing UI element: ${selector}`);
  return node as K extends keyof Controls ? Controls[K] : HTMLElement;
}
interface Product { slug?: string; currency?: string; priceType?: string; showcase?: boolean; synthetic?: boolean; productType?: string; sku: string; name: string; description: string; image: string; price: number; instock: number; categories: string[] }
interface CartItem extends Product { quantity: number; lineTotal: number }
interface Shipping { address: { recipient: string; line1: string }; city: { name: string; country: string }; cost: number; distanceKm: number; quotedAt: string }
interface Cart { currency?: string; items: CartItem[]; total: number; subtotal?: number; shipping?: Shipping | null }
interface Ops { summary: string; services: { name: string; status: string; latencyMs: number }[]; nextSteps: string[]; checkedAt: string }
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const money = (value: number, currency = cart.currency || 'INR') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
let products: Product[] = [], cart: Cart = { items: [], total: 0 }, category = '', cartBusy = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
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
function productPrice(p: Product) { return p.priceType === 'on-request' ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'EUR' }).format(p.price) + (p.showcase ? ' · reference' : ''); }
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
  try { cart = await api<Cart>('/api/cart', { method: 'POST', body: JSON.stringify({ sku, quantity }) }); renderCart(); return true; }
  catch (error) { toast(errorMessage(error)); return false; }
  finally { cartBusy = false; renderCart(); }
}
function renderCart() { $('#bag-count').textContent = String(cart.items.reduce((n, item) => n + item.quantity, 0)); }
async function loadOps() {
  $('#ops-content').replaceChildren(el('p', '', 'Checking services…'));
  try {
    const result = await api<Ops>('/api/ops');
    const nodes: HTMLElement[] = [el('p', '', result.summary)];
    for (const service of result.services) { const row = el('div', 'health-row'); row.append(el('span', '', service.name), el('span', service.status === 'healthy' ? 'healthy' : 'unavailable', `${service.status} · ${service.latencyMs} ms`)); nodes.push(row); }
    const steps = el('ul'); for (const step of result.nextSteps) steps.append(el('li', '', step)); nodes.push(steps, el('p', '', `Checked ${new Date(result.checkedAt).toLocaleTimeString()}. No infrastructure actions executed.`)); $('#ops-content').replaceChildren(...nodes);
  } catch (error) { $('#ops-content').replaceChildren(el('p', '', errorMessage(error))); }
}
$('#refresh-ops').addEventListener('click', loadOps);

await initAccount(async () => { cart = await api<Cart>('/api/cart'); renderCart(); });
await api<{ storeName: string; announcement: string; supportEmail: string; checkoutEnabled: boolean }>('/api/settings').then(settings => {
  document.title = settings.storeName;
  document.querySelectorAll<HTMLAnchorElement>('.wordmark').forEach(brand => { brand.textContent = settings.storeName; brand.setAttribute('aria-label', `${settings.storeName} home`); });
  const announcement = document.querySelector('.store-topline > span'); if (announcement && settings.announcement) announcement.textContent = settings.announcement;
  const footer = document.querySelector<HTMLElement>('#store-support'); if (footer && settings.supportEmail) { footer.textContent = `Contact: ${settings.supportEmail}`; footer.hidden = false; }
}).catch(() => {});
await Promise.all([loadProducts(), loadRecommendations(), api<Cart>('/api/cart').then(result => { cart = result; renderCart(); }).catch(() => toast('Your bag could not be loaded. Please try again.'))]);

if (new URLSearchParams(location.search).get('cart') === '1') location.replace(appPath('/cart'));
