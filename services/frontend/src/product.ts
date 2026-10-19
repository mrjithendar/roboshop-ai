import { appPath, basePath, productImage, canPurchase } from './paths.js';
import { currentUser, initAccount, showLogin } from './account.js';
interface Product { sku: string; slug: string; name: string; description: string; image: string; manufacturer?: string; model?: string; productType?: string; categories: string[]; price: number; currency: string; priceType: string; showcase: boolean; synthetic?: boolean; instock: number; specifications?: Record<string, string>; includedItems?: string[]; requiredAccessories?: string[]; compatibility?: string[]; packageNote?: string; priceCheckedAt?: string; sources?: { label: string; url: string }[]; imageAttribution?: { credit: string; sourceUrl?: string; licenseUrl?: string; license?: string } }
interface Review { id: string; title: string; body: string; rating: number; author: string; createdAt: string; synthetic: boolean; verifiedPurchase: boolean; status: string }
interface Page { reviews: Review[]; next: string | null; summary: { count: number; average: number | null }; kind: string; distribution?: Record<string, number> }
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, value = '') => { const node = document.createElement(tag); node.textContent = value; return node; };
async function api<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(appPath(path), { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Request failed. Please retry.'); return body;
}
const error = (e: unknown) => e instanceof Error ? e.message : 'Request failed. Please retry.';
const slug = location.pathname.slice(basePath.length).split('/')[2];
const endpoint = `/api/products/${encodeURIComponent(slug || '')}`;
let cursor: string | null = null, mine: Review | null = null, product: Product | null = null, generation = 0;
const price = (p: Product) => p.priceType === 'on-request' ? '' : `${new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'EUR' }).format(p.price)}${p.showcase ? ' · reference price, not a store offer' : ''}`;
function link(text: string, path: string, className = ''): HTMLAnchorElement {
  const node = element('a', text); node.href = appPath(path); node.className = className; return node;
}
function picture(p: Product): HTMLImageElement {
  const img = element('img'); img.src = productImage(p); img.alt = p.image === '/images/placeholder.png' ? `${p.productType || 'Robotics'} category illustration, not a photograph of ${p.name}` : p.name;
  img.width = 640; img.height = 520;
  img.addEventListener('error', () => { img.src = productImage({ image: '', productType: p.productType }); }, { once: true }); return img;
}
function render(p: Product, related: Product[]): void {
  document.title = `${p.name} · RobotShop`;
  const panel = get('product-content'); panel.replaceChildren();
  const breadcrumb = element('nav'); breadcrumb.className = 'product-breadcrumb'; breadcrumb.setAttribute('aria-label', 'Breadcrumb'); breadcrumb.append(link('Collection', '/'), element('span', '/'), element('span', p.name));
  const grid = element('div'); grid.className = 'product-detail-grid';
  const figure = element('figure'); figure.className = 'product-gallery'; const img = picture(p); img.className = 'detail-image';
  figure.append(img, element('figcaption', p.image === '/images/placeholder.png' ? 'Category illustration · see official sources for exact product appearance.' : p.imageAttribution?.credit || 'Product illustration'));
  const copy = element('div'); copy.className = 'purchase-panel';
  const eyebrow = element('p', [p.manufacturer, p.productType || 'Robotics'].filter(Boolean).join(' / ')); eyebrow.className = 'eyebrow';
  const description = element('p', p.description); description.className = 'product-summary';
  const priceText = element('p', price(p)); priceText.className = 'detail-price';
  const available = canPurchase(p), stock = Math.max(0, Math.floor(p.instock || 0));
  const status = element('p', available ? stock > 0 ? `In stock · ${stock} available` : 'Currently out of stock' : 'Showcase · not available to purchase'); status.className = 'availability ' + (available && stock > 0 ? 'in-stock' : '');
  copy.append(eyebrow, element('h1', p.name), element('p', `SKU ${p.sku}${p.model ? ` · Model ${p.model}` : ''}`), description, priceText, status);
  if (available) {
    const form = element('form'); form.className = 'purchase-actions';
    const label = element('label', 'Quantity'); const qty = element('input'); qty.type = 'number'; qty.min = '1'; qty.max = String(Math.min(20, stock)); qty.value = '1'; qty.required = true; qty.disabled = stock < 1; label.append(qty);
    const add = element('button', stock > 0 ? 'Add to cart' : 'Out of stock'); add.className = 'button primary'; add.disabled = stock < 1;
    const feedback = element('p'); feedback.className = 'purchase-feedback'; feedback.setAttribute('role','status'); feedback.setAttribute('aria-live','polite');
    const cartLink = link('View cart & checkout →', '/?cart=1', 'cart-checkout-link'); cartLink.hidden = true;
    form.addEventListener('submit', async event => {
      event.preventDefault(); add.disabled = true; add.textContent = 'Adding…'; feedback.textContent = ''; cartLink.hidden = true;
      try {
        const selected = Number(qty.value);
        if (!Number.isInteger(selected) || selected < 1 || selected > Math.min(20, stock)) throw new Error('Choose a quantity within the available stock (maximum 20).');
        const cart = await api<{ items: { sku: string; quantity: number }[] }>('/api/cart');
        const quantity = selected + (cart.items.find(item => item.sku === p.sku)?.quantity || 0);
        if (quantity > Math.min(20, stock)) throw new Error('Your cart already contains this product. Reduce the quantity or review your cart.');
        await api('/api/cart', 'POST', { sku: p.sku, quantity });
        feedback.textContent = `${selected} × ${p.name} added to your cart.`; cartLink.hidden = false;
      } catch (e) { feedback.textContent = error(e); }
      finally { add.disabled = stock < 1; add.textContent = 'Add to cart'; }
    });
    form.append(label, add, feedback, cartLink); copy.append(form);
    const note = element('p', 'Shipping is calculated at checkout. Sign in to complete your purchase.'); note.className = 'purchase-note'; copy.append(note);
  } else {
    const notice = element('div'); notice.className = 'showcase-panel'; notice.append(element('h3', 'Explore this product'), element('p', 'This is an informational listing. Reference prices and simulated stock are not a sale offer.'));
    const unavailable = element('button', 'Add to cart'); unavailable.className = 'button primary'; unavailable.disabled = true;
    notice.append(unavailable, element('p', 'Not sold by RobotShop. No checkout is available for this listing.'));
    copy.append(notice);
  }
  const buybox = element('aside'); buybox.className = 'product-buybox'; buybox.setAttribute('aria-label','Purchase options');
  for (const child of [...copy.children]) if (child.matches('.detail-price,.availability,.purchase-actions,.purchase-note,.showcase-panel')) buybox.append(child);
  const reviewsLink = link('Read customer reviews ↓','#reviews-section'); reviewsLink.className = 'product-review-anchor'; copy.append(reviewsLink);
  const highlights = element('ul'); highlights.className = 'product-highlights';
  for (const [key,value] of Object.entries(p.specifications || {}).slice(0,5)) highlights.append(element('li', `${key}: ${value}`)); copy.append(highlights);
  if (p.imageAttribution?.licenseUrl && p.imageAttribution?.sourceUrl) {
    for (const [label,url] of [['Photo source',p.imageAttribution.sourceUrl],[p.imageAttribution.license || 'Image license',p.imageAttribution.licenseUrl]]) {
      try { if (new URL(url).protocol !== 'https:') continue; const credit = element('a',label); credit.href=url; credit.rel='noopener noreferrer'; credit.target='_blank'; figure.append(credit); } catch {}
    }
  }
  grid.append(figure, copy, buybox); panel.append(breadcrumb, grid);
  const details = element('div'); details.className = 'product-information';
  const specifications = element('section'); specifications.className = 'information-card'; specifications.append(element('h2', 'Technical specifications'));
  const spec = element('dl'); for (const [key, value] of Object.entries(p.specifications || {})) spec.append(element('dt', key), element('dd', value));
  if (!spec.children.length) specifications.append(element('p', 'Detailed specifications are not yet available.')); else specifications.append(spec);
  details.append(specifications);
  const included = element('section'); included.className = 'information-card';
  for (const [title, values] of [['What’s included', p.includedItems], ['Required accessories', p.requiredAccessories], ['Compatibility', p.compatibility]] as const) {
    if (!values?.length) continue; included.append(element('h2', title)); const list = element('ul'); values.forEach(value => list.append(element('li', value))); included.append(list);
  }
  if (p.packageNote) included.append(element('p', p.packageNote)); if (included.children.length) details.append(included);
  const sources = element('section'); sources.className = 'product-sources'; sources.append(element('h2', 'Product documentation'));
  for (const source of p.sources || []) { try { const url = new URL(source.url); if (url.protocol !== 'https:') continue; const a = element('a', `${source.label} ↗`); a.href = url.href; a.rel = 'noopener noreferrer'; a.target = '_blank'; sources.append(a); } catch { /* Invalid source omitted. */ } }
  if (p.priceCheckedAt) sources.append(element('p', `Reference information checked ${new Date(p.priceCheckedAt).toLocaleDateString()}. Confirm current pricing and specifications with the manufacturer.`));
  panel.append(details); if ((p.sources || []).length) panel.append(sources);
  const recommendations = get('related-products'); recommendations.replaceChildren(); recommendations.hidden = !related.length;
  if (related.length) {
    recommendations.append(element('h2', 'Explore related products')); const cards = element('div'); cards.className = 'related-grid';
    for (const r of related) { const card = link('', `/products/${encodeURIComponent(r.slug || r.sku.toLowerCase())}`, 'related-card'); const image = picture(r); image.loading = 'lazy'; card.append(image, element('span', r.manufacturer || r.productType || 'Robotics'), element('h3', r.name), element('p', price(r))); cards.append(card); }
    recommendations.append(cards);
  }
}

async function loadReviews(append = false): Promise<void> {
  const current = ++generation, kind = 'real';
  get<HTMLButtonElement>('more-reviews').disabled = true;
  try {
    const result = await api<Page>(endpoint + '/reviews?' + new URLSearchParams({ kind, rating: get<HTMLSelectElement>('review-filter').value, after: append ? cursor || '' : '' }));
    if (current !== generation) return;
    if (!append) get('review-list').replaceChildren();
    if (!append && !result.reviews.length) get('review-list').append(element('p', 'No reviews yet. Share your experience with this product.'));
    get('rating-summary').textContent = `Customer ratings: ${result.summary.count} reviews${result.summary.average === null ? '' : ` · ${result.summary.average.toFixed(1)}/5`}`;
    const distribution = get('rating-distribution'); distribution.replaceChildren();
    const total = Object.values(result.distribution || {}).reduce((a,b)=>a+b,0);
    for (let rating=5;rating>=1;rating--) {
      const count=result.distribution?.[String(rating)] || 0, row=element('div'); row.className='rating-bar';
      const meter=element('meter'); meter.min=0; meter.max=total || 1; meter.value=count; meter.setAttribute('aria-label',`${rating} stars: ${count} reviews`);
      row.append(element('span',`${rating} star`),meter,element('span',`${total ? Math.round(count/total*100) : 0}%`)); distribution.append(row);
    }
    for (const review of result.reviews) { const article = element('article'); article.className = 'review'; article.append(element('h3', `${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)} · ${review.title}`), element('p', `${review.synthetic ? 'SYNTHETIC DEMO REVIEW' : review.author}${review.verifiedPurchase ? ' · Verified purchase' : ''} · ${new Date(review.createdAt).toLocaleDateString()}`), element('p', review.body)); get('review-list').append(article); }
    cursor = result.next; get('more-reviews').hidden = !cursor;
  } catch (e) { get('rating-summary').textContent = error(e); }
  finally { if (current === generation) get<HTMLButtonElement>('more-reviews').disabled = false; }
}
let demoCursor: string | null = null;
async function loadDemoReviews(append = false): Promise<void> {
  const more = get<HTMLButtonElement>('more-demo-reviews'); more.disabled = true;
  try {
    const page = await api<Page>(endpoint + '/reviews?' + new URLSearchParams({kind: 'demo', after: append ? demoCursor || '' : ''}));
    const list = get('demo-review-list');
    if (!append) list.replaceChildren();
    for (const review of page.reviews.filter(row => row.synthetic)) {
      const article = element('article'); article.className = 'review';
      article.append(element('h3', `${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)} · ${review.title}`), element('p', 'SYNTHETIC DEMO REVIEW · Not a verified purchase'), element('p', review.body));
      list.append(article);
    }
    get('demo-reviews-section').hidden = !list.children.length;
    demoCursor = page.next; more.hidden = !demoCursor;
  } catch { /* Optional demo data must never interrupt real customer reviews. */ }
  finally { more.disabled = false; }
}
get('more-demo-reviews').addEventListener('click', () => { void loadDemoReviews(true); });

async function loadMine(): Promise<void> {
  mine = null; get<HTMLInputElement>('review-title').value = ''; get<HTMLTextAreaElement>('review-body').value = ''; get('review-delete').hidden = true; get('review-form').hidden = !currentUser; get('review-status').textContent = currentUser ? 'Reviews are moderated before publication.' : 'Log in to write a review.';
  if (!currentUser || !product) return;
  const userId = currentUser.id;
  try { const result = await api<{ review: Review | null }>(endpoint + '/reviews/mine'); if (currentUser?.id !== userId) return; mine = result.review; get<HTMLInputElement>('review-title').value = mine?.title || ''; get<HTMLTextAreaElement>('review-body').value = mine?.body || ''; get<HTMLSelectElement>('review-rating').value = String(mine?.rating || 5); get('review-delete').hidden = !mine; if (mine) get('review-status').textContent = `Your review is ${mine.status}. Editing resubmits it for moderation.`; }
  catch (e) { get('review-status').textContent = error(e); }
}
get('review-filter').addEventListener('change', () => { void loadReviews(); });

get('more-reviews').addEventListener('click', () => { void loadReviews(true); });
get('review-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!currentUser) { showLogin(); return; } const button = get<HTMLButtonElement>('review-save'); button.disabled = true;
  try { await api(endpoint + '/reviews', mine ? 'PUT' : 'POST', { rating: Number(get<HTMLSelectElement>('review-rating').value), title: get<HTMLInputElement>('review-title').value, body: get<HTMLTextAreaElement>('review-body').value }); await loadMine(); await loadReviews(); } catch (e) { get('review-status').textContent = error(e); } finally { button.disabled = false; }
});
get('review-delete').addEventListener('click', async () => { const button = get<HTMLButtonElement>('review-delete'); button.disabled = true; try { await api(endpoint + '/reviews', 'DELETE'); await loadMine(); await loadReviews(); } catch (e) { get('review-status').textContent = error(e); } finally { button.disabled = false; } });
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.addEventListener('click', () => get<HTMLDialogElement>(button.dataset.close || '').close()));
await initAccount(loadMine);
try { const result = await api<{ product: Product; related: Product[] }>(endpoint); product = result.product; render(product, result.related); get('product-status').textContent = ''; get('reviews-section').hidden = false; await Promise.all([loadReviews(), loadMine(), loadDemoReviews()]); }
catch (e) { document.title = 'Product unavailable · RobotShop'; get('product-status').textContent = error(e); const retry = element('button', 'Retry loading product'); retry.addEventListener('click', () => location.reload()); get('product-content').append(retry); }
