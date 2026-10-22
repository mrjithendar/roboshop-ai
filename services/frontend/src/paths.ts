// Resolve the mount path from this module URL; works at / and /roboshop/.
export const basePath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
export function appPath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? basePath + path : path;
}

export function productImage(product: { image: string; productType?: string }): string {
  if (product.image && product.image !== '/images/placeholder.png') return appPath(product.image);
  const category = product.productType === 'complete robot' ? 'robot' : product.productType === 'kit' ? 'kit' : product.productType === 'accessory' ? 'accessory' : 'component';
  return appPath(`/illustrations/${category}.svg`);
}
export function canPurchase(product: { showcase?: boolean; synthetic?: boolean; demo?: boolean; currency?: string; priceType?: string; collection?: string; sku?: string }): boolean {
  return product.collection !== 'reference' && !product.sku?.startsWith('REF-') && !product.showcase && (!product.synthetic || product.demo === true) && ['EUR', 'USD', 'INR'].includes(product.currency || 'EUR') && (product.priceType || 'sale') === 'sale';
}

export function formatProductPrice(p: { price: number; currency?: string; priceType?: string; showcase?: boolean; demo?: boolean; collection?: string }): string {
  if (p.priceType === 'on-request') return 'Price on request';
  const original = new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'EUR' }).format(p.price);
  const rate = fx?.rates[p.currency || 'EUR'], target = fx?.rates[displayCurrency];
  const converted = rate && target && displayCurrency !== (p.currency || 'EUR') && validFx(fx);
  const amount = converted ? new Intl.NumberFormat(undefined, { style: 'currency', currency: displayCurrency }).format(p.price / rate * target) : original;
  if (p.priceType === 'reference' || p.showcase || p.collection === 'reference') return `${amount} · reference price, not a store offer`;
  if (p.priceType === 'illustrative' || p.demo || p.collection === 'demo') return `${amount} · demo price`;
  return amount;
}

// Display-only estimates: never write converted values into products, cart or orders.
type PriceListing = Parameters<typeof formatProductPrice>[0];
type Fx = { rates: Record<string, number>; asOf: string; suggestedCurrency?: string; stale?: boolean; displayOnly: boolean };
let fx: Fx | null = null, displayCurrency = '';
const priceBindings = new Map<HTMLElement, PriceListing>();
function validFx(value: Fx | null): value is Fx {
  if (!value || value.displayOnly !== true || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf)) return false;
  const age = Date.now() - Date.parse(value.asOf + 'T00:00:00Z');
  return age >= 0 && age < 8 * 86400000 && !!value.rates && Object.entries(value.rates).every(([code, rate]) => /^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0 && rate <= 1000000);
}
export function bindProductPrice(node: HTMLElement, listing: PriceListing): HTMLElement {
  node.textContent = formatProductPrice(listing); priceBindings.set(node, listing); return node;
}
function updatePrices(): void {
  for (const [node, listing] of priceBindings) {
    if (node.isConnected) node.textContent = formatProductPrice(listing);
    else priceBindings.delete(node);
  }
}
export async function loadCurrencyRates(): Promise<Fx> {
  let country = '';
  // Browser hints are not verified location. No IP lookup or precise geolocation.
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    country = ['Asia/Kolkata', 'Asia/Calcutta'].includes(zone) ? 'IN' : new Intl.Locale(navigator.language).region || '';
  } catch { /* No region: use the store's INR display default. */ }
  const response = await fetch(appPath('/api/currency/rates') + '?country=' + encodeURIComponent(country), { signal: AbortSignal.timeout(2500), credentials: 'omit' });
  if (!response.ok) throw new Error('FX unavailable');
  const value: Fx = await response.json();
  if (!validFx(value)) throw new Error('Invalid FX data');
  return value;
}

export const storefrontCurrencies = ['INR', 'USD', 'GBP', 'SGD', 'AUD'];

// Shared header UI; checkout still owns its authoritative quote and reservation.
export function syncCurrencyButton(): void {
  const select = document.querySelector<HTMLSelectElement>('#display-currency');
  const button = document.querySelector<HTMLButtonElement>('#currency-button');
  if (!select || !button) return;
  button.textContent = select.value || 'Currency';
  button.disabled = select.disabled;
  button.setAttribute('aria-label', `Change currency (${select.value || 'loading'})`);
}
export function setupCurrencyButton(): void {
  const control = document.querySelector<HTMLElement>('#currency-control');
  const button = document.querySelector<HTMLButtonElement>('#currency-button');
  const menu = document.querySelector<HTMLElement>('#currency-menu');
  const select = document.querySelector<HTMLSelectElement>('#display-currency');
  if (!control || !button || !menu || !select || button.dataset.bound) return;
  button.dataset.bound = 'true';
  const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) select.focus();
  });
  select.addEventListener('change', () => { syncCurrencyButton(); close(); button.focus(); });
  document.addEventListener('click', event => { if (!control.contains(event.target as Node)) close(); });
  control.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); button.focus(); } });
  syncCurrencyButton();
}

export async function initCurrency(): Promise<void> {
  const control = document.querySelector<HTMLElement>('#currency-control');
  const select = document.querySelector<HTMLSelectElement>('#display-currency');
  const status = document.querySelector<HTMLElement>('#currency-status');
  if (!control || !select || !status) return;
  control.hidden = false;
  setupCurrencyButton();
  try { fx = await loadCurrencyRates(); } catch { fx = null; }
  let saved = ''; try { saved = localStorage.getItem('roboshop.displayCurrency') || ''; } catch { /* Storage optional */ }
  displayCurrency = storefrontCurrencies.includes(saved) ? saved : storefrontCurrencies.includes(fx?.suggestedCurrency || '') ? fx!.suggestedCurrency! : 'INR';
  select.replaceChildren(...storefrontCurrencies.map(code => new Option(code, code)));
  select.value = displayCurrency; select.disabled = false;
  const update = () => {
    displayCurrency = select.value;
    try { localStorage.setItem('roboshop.displayCurrency', displayCurrency); } catch { /* Optional storage */ }
    status.textContent = fx?.rates[displayCurrency]
      ? 'Selected from your browser region. You can change it here; checkout confirms the final total.'
      : 'Local currency estimates unavailable. Showing original prices; shopping remains available.';
    updatePrices(); syncCurrencyButton();
  };
  update(); select.addEventListener('change', update);
}
