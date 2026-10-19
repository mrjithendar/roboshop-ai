import { currentUser, initAccount, showLogin } from './account.js';
interface Product { sku: string; slug: string; name: string; description: string; image: string; manufacturer?: string; model?: string; productType?: string; categories: string[]; price: number; currency: string; priceType: string; showcase: boolean; synthetic?: boolean; instock: number; specifications?: Record<string, string>; includedItems?: string[]; requiredAccessories?: string[]; compatibility?: string[]; packageNote?: string; priceCheckedAt?: string; sources?: { label: string; url: string }[]; imageAttribution?: { credit: string } }
interface Review { id: string; title: string; body: string; rating: number; author: string; createdAt: string; synthetic: boolean; verifiedPurchase: boolean; status: string }
interface Page { reviews: Review[]; next: string | null; summary: { count: number; average: number | null }; kind: string }
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, value = '') => { const node = document.createElement(tag); node.textContent = value; return node; };
async function api<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Request failed. Please retry.'); return body;
}
const error = (e: unknown) => e instanceof Error ? e.message : 'Request failed. Please retry.';
const slug = location.pathname.split('/')[2];
const endpoint = `/api/products/${encodeURIComponent(slug || '')}`;
let cursor: string | null = null, mine: Review | null = null, product: Product | null = null, generation = 0;
const price = (p: Product) => p.priceType === 'on-request' ? 'Price on request' : `${new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'EUR' }).format(p.price)}${p.showcase ? ' · reference price, not a store offer' : ''}`;
function render(p: Product, related: Product[]): void {
  document.title = `${p.name} · RobotShop`;
  const panel = get('product-content'); panel.replaceChildren();
  const grid = element('div'); grid.className = 'product-detail-grid'; const copy = element('div');
  const figure = element('figure'), img = element('img'); img.src = p.image; img.alt = p.showcase ? `Placeholder for ${p.name}; product photograph not licensed` : p.name; img.className = 'detail-image';
  img.addEventListener('error', () => { img.src = '/images/placeholder.png'; }, { once: true });
  figure.append(img, element('figcaption', p.imageAttribution?.credit || 'Product illustration'));
  copy.append(element('p', `${p.manufacturer || ''} · ${p.productType || 'Product'}`), element('h1', p.name), element('p', p.description), element('p', price(p)), element('p', p.showcase ? 'Showcase only · availability and fulfilment are simulated. No real-money checkout.' : `${p.instock} available`));
  if (p.priceCheckedAt) copy.append(element('p', `Source checked ${new Date(p.priceCheckedAt).toLocaleDateString()}. Prices may have changed; confirm taxes, shipping and bundle with the source.`));
  if (!p.showcase && !p.synthetic && p.currency === 'EUR' && p.priceType === 'sale') {
    const label = element('label', 'Quantity '), qty = element('input'); qty.type = 'number'; qty.min = '1'; qty.max = String(Math.min(20, p.instock)); qty.value = '1'; label.append(qty);
    const add = element('button', 'Add to bag'); add.disabled = p.instock < 1;
    add.addEventListener('click', async () => { add.disabled = true; try { const cart = await api<{ items: { sku: string; quantity: number }[] }>('/api/cart'); const selected = Number(qty.value); if (!Number.isInteger(selected) || selected < 1 || selected > 20) throw new Error('Choose a quantity from 1 to 20.'); const quantity = selected + (cart.items.find(i => i.sku === p.sku)?.quantity || 0); await api('/api/cart', 'POST', { sku: p.sku, quantity }); get('product-status').textContent = 'Added to bag. Open Collection & bag to checkout.'; } catch (e) { get('product-status').textContent = error(e); } finally { add.disabled = p.instock < 1; } }); copy.append(label, add);
  }
  grid.append(figure, copy); panel.append(grid, element('h2', 'Specifications'));
  const spec = element('dl'); for (const [k, v] of Object.entries(p.specifications || {})) spec.append(element('dt', k), element('dd', v)); panel.append(spec);
  for (const [title, values] of [['Included items', p.includedItems], ['Required accessories', p.requiredAccessories], ['Compatibility', p.compatibility]] as const) { panel.append(element('h2', title)); const list = element('ul'); for (const value of values || ['Consult the product documentation.']) list.append(element('li', value)); panel.append(list); }
  panel.append(element('p', p.packageNote || ''), element('h2', 'Official sources'));
  for (const source of p.sources || []) { try { const url = new URL(source.url); if (url.protocol !== 'https:') continue; const a = element('a', source.label); a.href = url.href; a.rel = 'noopener noreferrer'; const paragraph = element('p'); paragraph.append(a); panel.append(paragraph); } catch { /* Invalid source omitted. */ } }
  const recommendations = get('related-products'); recommendations.replaceChildren(element('h2', 'Related products'));
  for (const r of related) { const link = element('a', `${r.name} · ${price(r)}`); link.href = `/products/${encodeURIComponent(r.slug || r.sku.toLowerCase())}`; const paragraph = element('p'); paragraph.append(link); recommendations.append(paragraph); }
}
async function loadReviews(append = false): Promise<void> {
  const current = ++generation, kind = get<HTMLSelectElement>('review-kind').value;
  get<HTMLButtonElement>('more-reviews').disabled = true;
  try {
    const result = await api<Page>(endpoint + '/reviews?' + new URLSearchParams({ kind, after: append ? cursor || '' : '' }));
    if (current !== generation) return;
    if (!append) get('review-list').replaceChildren();
    get('rating-summary').textContent = `${kind === 'demo' ? 'Synthetic demo' : 'Real customer'} ratings: ${result.summary.count} reviews${result.summary.average === null ? '' : ` · ${result.summary.average.toFixed(1)}/5`}`;
    for (const review of result.reviews) { const article = element('article'); article.className = 'review'; article.append(element('h3', `${review.rating}/5 · ${review.title}`), element('p', `${review.synthetic ? 'SYNTHETIC DEMO REVIEW' : review.author}${review.verifiedPurchase ? ' · Verified purchase' : ''} · ${new Date(review.createdAt).toLocaleDateString()}`), element('p', review.body)); get('review-list').append(article); }
    cursor = result.next; get('more-reviews').hidden = !cursor;
  } catch (e) { get('rating-summary').textContent = error(e); }
  finally { if (current === generation) get<HTMLButtonElement>('more-reviews').disabled = false; }
}
async function loadMine(): Promise<void> {
  mine = null; get<HTMLInputElement>('review-title').value = ''; get<HTMLTextAreaElement>('review-body').value = ''; get('review-delete').hidden = true; get('review-form').hidden = !currentUser; get('review-status').textContent = currentUser ? 'Reviews are moderated before publication.' : 'Log in to write a review.';
  if (!currentUser || !product) return;
  const userId = currentUser.id;
  try { const result = await api<{ review: Review | null }>(endpoint + '/reviews/mine'); if (currentUser?.id !== userId) return; mine = result.review; get<HTMLInputElement>('review-title').value = mine?.title || ''; get<HTMLTextAreaElement>('review-body').value = mine?.body || ''; get<HTMLSelectElement>('review-rating').value = String(mine?.rating || 5); get('review-delete').hidden = !mine; if (mine) get('review-status').textContent = `Your review is ${mine.status}. Editing resubmits it for moderation.`; }
  catch (e) { get('review-status').textContent = error(e); }
}
get('review-kind').addEventListener('change', () => { void loadReviews(); });
get('more-reviews').addEventListener('click', () => { void loadReviews(true); });
get('review-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!currentUser) { showLogin(); return; } const button = get<HTMLButtonElement>('review-save'); button.disabled = true;
  try { await api(endpoint + '/reviews', mine ? 'PUT' : 'POST', { rating: Number(get<HTMLSelectElement>('review-rating').value), title: get<HTMLInputElement>('review-title').value, body: get<HTMLTextAreaElement>('review-body').value }); await loadMine(); await loadReviews(); } catch (e) { get('review-status').textContent = error(e); } finally { button.disabled = false; }
});
get('review-delete').addEventListener('click', async () => { const button = get<HTMLButtonElement>('review-delete'); button.disabled = true; try { await api(endpoint + '/reviews', 'DELETE'); await loadMine(); await loadReviews(); } catch (e) { get('review-status').textContent = error(e); } finally { button.disabled = false; } });
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.addEventListener('click', () => get<HTMLDialogElement>(button.dataset.close || '').close()));
await initAccount(loadMine);
try { const result = await api<{ product: Product; related: Product[] }>(endpoint); product = result.product; render(product, result.related); get('product-status').textContent = ''; get('reviews-section').hidden = false; await Promise.all([loadReviews(), loadMine()]); }
catch (e) { document.title = 'Product unavailable · RobotShop'; get('product-status').textContent = error(e); const retry = element('button', 'Retry loading product'); retry.addEventListener('click', () => location.reload()); get('product-content').append(retry); }
