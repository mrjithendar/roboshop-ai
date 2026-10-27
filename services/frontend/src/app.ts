import { appPath, productImage, canPurchase, formatProductPrice, bindProductPrice, initCurrency } from './paths.js';
import { initAccount } from './account.js';
export {};

// ID selectors carry their actual DOM type; a missing element fails at startup.
type Controls = {
  '#search': HTMLInputElement; '#in-stock': HTMLInputElement; '#sort': HTMLSelectElement; '#collection-filter': HTMLSelectElement;
  '#send-message': HTMLButtonElement; '#message': HTMLTextAreaElement;
};
function $<K extends string>(selector: K): K extends keyof Controls ? Controls[K] : HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing UI element: ${selector}`);
  return node as K extends keyof Controls ? Controls[K] : HTMLElement;
}
interface Product { collection?: string; demo?: boolean; manufacturer?: string; model?: string; priceBasis?: string; checkedAt?: string; unresolvedFields?: string[];  slug?: string; currency?: string; priceType?: string; showcase?: boolean; synthetic?: boolean; productType?: string; sku: string; name: string; description: string; image: string; price: number; instock: number; categories: string[] }
type CartItem = (Product & { quantity: number; lineTotal: number; unavailable?: false })
  | { sku: string; quantity: number; unavailable: true };
interface Shipping { address: { recipient: string; line1: string }; city: { name: string; country: string }; cost: number; distanceKm: number; quotedAt: string }
interface Cart { currency?: string; items: CartItem[]; total: number; subtotal?: number; shipping?: Shipping | null }
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
function image(p: Product, className = '') { const img = el('img', className); img.src = productImage(p); img.alt = p.image === '/images/placeholder.png' ? `Category illustration, not a photograph of ${p.name}` : p.name; img.loading = 'lazy'; img.addEventListener('error', () => { img.src = productImage({ image: '', productType: p.productType }); }, { once: true }); return img; }
const productPrice = formatProductPrice;
const canBuy = canPurchase;
function addButton(p: Product) {
  const button = el('button', 'add-button', canBuy(p) ? 'Add to cart' : 'View details');
  if (!canBuy(p)) { button.setAttribute('aria-label', `View ${p.name} showcase details`); button.addEventListener('click', () => detail(p)); return button; } button.setAttribute('aria-label', `Add ${p.name} to bag`); button.disabled = p.instock < 1;
  button.addEventListener('click', async () => { button.disabled = true; await add(p); button.disabled = p.instock < 1; }); return button;
}
function card(p: Product) {
  const article = el('article', 'product-card');
  const visual = el('a', 'product-image-button'); visual.href = appPath(`/products/${encodeURIComponent(p.slug || p.sku.toLowerCase())}`); visual.setAttribute('aria-label', `View ${p.name}`); visual.append(image(p), el('span', 'product-badge', p.collection === 'reference' ? 'REFERENCE · NOT FOR SALE' : p.demo ? 'DEMO · SIMULATED' : p.showcase ? 'SHOWCASE' : p.instock > 0 ? 'AVAILABLE' : 'OUT OF STOCK'));
  const title = el('a', 'product-title', p.name); title.href = visual.href;
  const bottom = el('div', 'product-bottom'); bottom.append(bindProductPrice(el('span', 'product-price'), p), addButton(p));
  if (p.image === '/images/placeholder.png') visual.append(el('span', 'image-caption', 'Category illustration · not a product photo'));
  article.append(visual, el('p', 'product-category', [p.productType, ...p.categories].filter(Boolean).join(' / ')), title, el('p', 'product-description', p.description), bottom);
  return article;
}
// Filters live in the URL so a filtered view can be shared, bookmarked and restored on reload.
function selectCategory(value: string) { category = value; document.querySelectorAll<HTMLElement>('[data-category]').forEach(tab => { const active = (tab.dataset.category || '') === value; tab.classList.toggle('selected', active); tab.setAttribute('aria-pressed', String(active)); }); }
function filtersActive() { return Boolean($('#search').value.trim() || category || $('#collection-filter').value || $('#in-stock').checked); }
function saveFilters() {
  const params = new URLSearchParams(location.search);
  const values: Record<string, string> = { q: $('#search').value.trim(), category, collection: $('#collection-filter').value, sort: $('#sort').value === 'featured' ? '' : $('#sort').value, stock: $('#in-stock').checked ? '1' : '' };
  for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); }
  const search = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
}
function restoreFilters() {
  const params = new URLSearchParams(location.search);
  $('#search').value = params.get('q') || '';
  for (const [key, control] of [['collection', $('#collection-filter')], ['sort', $('#sort')]] as const) { const value = params.get(key); if (value && [...control.options].some(option => option.value === value)) control.value = value; }
  $('#in-stock').checked = params.get('stock') === '1';
  const wanted = params.get('category') || '';
  if ([...document.querySelectorAll<HTMLElement>('[data-category]')].some(tab => tab.dataset.category === wanted)) selectCategory(wanted);
}
function clearFilters() { $('#search').value = ''; $('#collection-filter').value = ''; $('#in-stock').checked = false; selectCategory(''); renderProducts(); }
function renderProducts() {
  const query = $('#search').value.toLowerCase().trim();
  let visible = products.filter(p => (!$('#collection-filter').value || (p.collection || (p.demo ? 'demo' : 'merchant')) === $('#collection-filter').value) && (!category || p.categories.includes(category)) && (!$('#in-stock').checked || p.instock > 0) && `${p.name} ${p.manufacturer || ''} ${p.model || ''} ${p.description} ${p.categories.join(' ')}`.toLowerCase().includes(query));
  const sort = $('#sort').value;
  visible.sort(sort === 'price-low' ? (a, b) => (a.currency || 'EUR').localeCompare(b.currency || 'EUR') || Number(a.priceType === 'on-request') - Number(b.priceType === 'on-request') || (a.priceType || 'sale').localeCompare(b.priceType || 'sale') || a.price - b.price : sort === 'price-high' ? (a, b) => (a.currency || 'EUR').localeCompare(b.currency || 'EUR') || Number(a.priceType === 'on-request') - Number(b.priceType === 'on-request') || (a.priceType || 'sale').localeCompare(b.priceType || 'sale') || b.price - a.price : sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => Number(b.image.startsWith('/product-media/')) - Number(a.image.startsWith('/product-media/')));
  $('#products').replaceChildren(...visible.map(card)); $('#products').removeAttribute('aria-busy');
  if (!visible.length) {
    const empty = el('div', 'empty-state'); empty.append(el('h3', '', 'No robots match just yet.'), el('p', '', 'Try another search or category.'));
    if (filtersActive()) { const reset = el('button', 'button secondary', 'Clear filters'); reset.type = 'button'; reset.addEventListener('click', clearFilters); empty.append(reset); }
    $('#products').append(empty);
  }
  $('#result-count').textContent = `${visible.length} ${filtersActive() ? `of ${products.length} ` : ''}robotics product${visible.length === 1 ? '' : 's'}`;
  $('#product-count').textContent = String(products.length);
  $('#clear-filters').hidden = !filtersActive();
  saveFilters();
}
async function loadProducts() {
  $('#catalogue-error').hidden = true;
  try { products = (await api<{ products: Product[] }>('/api/products')).products; renderProducts(); }
  catch { $('#products').replaceChildren(); $('#products').removeAttribute('aria-busy'); $('#catalogue-error').hidden = false; $('#result-count').textContent = 'Collection unavailable'; }
}
async function loadRecommendations() {
  try { $('#recommendations').replaceChildren(...(await api<{ products: Product[] }>('/api/recommendations')).products.map(card)); }
  catch { $('#recommendations').replaceChildren(el('p', 'empty-state', 'Recommendations are unavailable right now. Explore the collection above.')); }
  finally { $('#recommendations').removeAttribute('aria-busy'); }
}
$('#retry-products').addEventListener('click', loadProducts);
$('#collection-filter').addEventListener('change', renderProducts); $('#clear-filters').addEventListener('click', clearFilters);
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault(); $('#search').focus();
});
$('#search').addEventListener('input', renderProducts); $('#sort').addEventListener('change', renderProducts); $('#in-stock').addEventListener('change', renderProducts);
document.querySelectorAll<HTMLElement>('[data-category]').forEach(button => button.addEventListener('click', () => { selectCategory(button.dataset.category || ''); renderProducts(); }));
restoreFilters();
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


await initAccount(async () => { cart = await api<Cart>('/api/cart'); renderCart(); });
await api<{ storeName: string; announcement: string; supportEmail: string; checkoutEnabled: boolean }>('/api/settings').then(settings => {
  document.title = settings.storeName;
  document.querySelectorAll<HTMLAnchorElement>('.wordmark').forEach(brand => { brand.textContent = settings.storeName; brand.setAttribute('aria-label', `${settings.storeName} home`); });
  const announcement = document.querySelector('.store-topline > span'); if (announcement && settings.announcement) announcement.textContent = settings.announcement;
  const footer = document.querySelector<HTMLElement>('#store-support'); if (footer && settings.supportEmail) { footer.textContent = `Contact: ${settings.supportEmail}`; footer.hidden = false; }
}).catch(() => {});
await Promise.all([loadProducts(), loadRecommendations(), api<Cart>('/api/cart').then(result => { cart = result; renderCart(); }).catch(() => toast('Your bag could not be loaded. Please try again.'))]);

if (new URLSearchParams(location.search).get('cart') === '1') location.replace(appPath('/cart'));

void initCurrency();
