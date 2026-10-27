import { appPath, initCurrency } from './paths.js';
void initCurrency();
export {};
interface AdminProduct { image?: string; currency?: string; priceType?: string; showcase?: boolean; sku: string; name: string; description: string; price: number; instock: number; categories: string[]; archived: boolean; revision: number; available: number }
interface AdminUser { id: string; name: string; email: string; role: 'customer' | 'admin' | 'superadmin'; disabled: boolean }
interface Settings { storeName: string; announcement: string; supportEmail: string; checkoutEnabled: boolean }
const control = <T extends HTMLElement>(id: string): T => { const node = document.getElementById(id); if (!node) throw new Error(`Missing control ${id}`); return node as T; };
const input = (id: string) => control<HTMLInputElement>(id);
const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, content = ''): HTMLElementTagNameMap[K] => { const result = document.createElement(tag); result.textContent = content; return result; };
const badge = (text: string, tone = '') => { const result = node('span', text); result.className = 'admin-badge'; if (tone) result.dataset.tone = tone; return result; };
// Status messages carry a tone so success and failure are distinguishable at a glance.
function notify(id: string, text: string, tone: 'success' | 'error' | '' = ''): void { const target = control(id); target.textContent = text; if (tone) target.dataset.tone = tone; else delete target.dataset.tone; }
control<HTMLAnchorElement>('admin-login').href = appPath('/login') + '?returnTo=' + encodeURIComponent(appPath('/admin'));
async function adminRequest<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(appPath(path), { method, headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) {
    if ([401, 403].includes(response.status)) { control('admin-content').hidden = true; control('admin-login').hidden = false; notify('admin-status', 'Your account no longer has access to this action. Log in again.', 'error'); }
    throw new Error((result.error || 'Request failed.') + (result.requestId ? ` (Request ${result.requestId})` : ''));
  }
  return result;
}
// Storefront category filters (index.html) only recognise these names.
const STANDARD_CATEGORIES = ['educational kits', 'robot arms', 'mobile robots', 'components', 'accessories'];
const IMAGE_PATH = /^(?:\/product-media\/[a-z0-9-]+\.(?:jpg|png)|\/images\/[A-Za-z0-9_-]+\.png|\/api\/product-images\/[0-9a-f]{32}\.jpg)$/;
const MAX_UPLOAD_CHARS = 1_400_000;
const when = (value?: string | null) => { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const amount = (value: number | null | undefined, currency = 'INR') => typeof value === 'number' ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value) : '—';
let stockEditable = true;
let editing: AdminProduct | null = null, nextUsers: string | null = null, adminProducts: AdminProduct[] = [], productSnapshot = '', reviewsLoaded = false, reviewCursor: string | null = null;
const LOW_STOCK = 5;
const tabNames = ['products', 'editor', 'reviews', 'orders', 'users', 'settings', 'llm', 'audit'];
const loaded = new Set<string>();
function selectTab(name: string): void {
  if (control(`tab-${name}`).hidden) return;
  if (name !== 'editor' && !control('panel-editor').hidden && productDirty() && !confirm('Discard unsaved product changes?')) return;
  for (const key of tabNames) {
    const active = name === key;
    control(`tab-${key}`).setAttribute('aria-selected', String(active));
    control(`tab-${key}`).tabIndex = active ? 0 : -1;
    control(`panel-${key}`).hidden = !active;
  }
  if (name === 'reviews' && !reviewsLoaded) { reviewsLoaded = true; void moderateList(); }
  if (name === 'orders' && !loaded.has('orders')) { loaded.add('orders'); void loadOrders(); }
  if (name === 'audit' && !loaded.has('audit')) { loaded.add('audit'); void loadAudit(); }
}
for (const key of tabNames) {
  const tab = control(`tab-${key}`);
  tab.addEventListener('click', () => { if (key === 'editor' && !editing) edit(null); else selectTab(key); });
  tab.addEventListener('keydown', event => {
    const visible = tabNames.filter(name => !control(`tab-${name}`).hidden);
    let index = visible.indexOf(key);
    if (event.key === 'ArrowRight') index = (index + 1) % visible.length;
    else if (event.key === 'ArrowLeft') index = (index + visible.length - 1) % visible.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = visible.length - 1;
    else return;
    event.preventDefault(); control(`tab-${visible[index]}`).focus(); control(`tab-${visible[index]}`).click();
  });
}
const productFields = ['product-image', 'category-options', 'product-sku', 'product-name', 'product-description', 'product-price', 'product-stock', 'product-categories', 'product-archived'];
const productState = () => JSON.stringify(productFields.map(id => id === 'category-options' ? categoryBoxes().map(box => box.checked) : (field => field.type === 'checkbox' ? field.checked : field.value)(control<HTMLInputElement>(id))));
const productDirty = () => !control('product-form').hidden && productState() !== productSnapshot;
control('product-form').addEventListener('input', () => { control('product-dirty').hidden = !productDirty(); });
addEventListener('beforeunload', event => { if (productDirty()) event.preventDefault(); });
function previewImage(): void {
  const path = input('product-image').value.trim();
  const preview = control<HTMLImageElement>('product-image-preview');
  const valid = IMAGE_PATH.test(path);
  preview.hidden = !valid; control('image-placeholder').hidden = valid;
  control('product-image-remove').hidden = !path;
  notify('product-image-status', path && !valid ? 'This path is not served by the storefront. Upload the image instead.' : '', path && !valid ? 'error' : '');
  if (valid) preview.src = appPath(path);
  else preview.removeAttribute('src');
}
// Resize in the browser so uploads stay small; the gateway re-encodes and validates again.
async function prepareImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (Math.min(bitmap.width, bitmap.height) < 200) throw new Error('Choose an image at least 200 × 200 pixels.');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let quality = .9, value = canvas.toDataURL('image/jpeg', quality);
    while (value.length > MAX_UPLOAD_CHARS && quality > .4) { quality -= .1; value = canvas.toDataURL('image/jpeg', quality); }
    if (value.length > MAX_UPLOAD_CHARS) throw new Error('This image is too detailed to upload. Try a smaller image.');
    return value;
  } finally { bitmap.close(); }
}
async function uploadImage(file: File): Promise<void> {
  const picker = input('product-image-file'); picker.disabled = true; control('image-drop').classList.add('busy');
  notify('product-image-status', 'Uploading image…');
  try {
    const { image } = await adminRequest<{ image: string }>('/api/admin/product-images', 'POST', { image: await prepareImage(file) });
    input('product-image').value = image; previewImage(); control('product-dirty').hidden = !productDirty();
    notify('product-image-status', 'Image uploaded. Save the product to publish it.', 'success');
  } catch (error) { notify('product-image-status', message(error), 'error'); }
  finally { picker.disabled = false; picker.value = ''; control('image-drop').classList.remove('busy'); }
}
input('product-image-file').addEventListener('change', () => { const file = input('product-image-file').files?.[0]; if (file) void uploadImage(file); });
const drop = control('image-drop');
drop.addEventListener('dragover', event => { if (input('product-image-file').disabled) return; event.preventDefault(); drop.classList.add('dragging'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragging'); const file = event.dataTransfer?.files[0]; if (file && !input('product-image-file').disabled) void uploadImage(file); });
control('product-image-remove').addEventListener('click', () => { input('product-image').value = ''; previewImage(); control('product-dirty').hidden = !productDirty(); });
// Standard categories are checkboxes so a typo cannot hide a product from storefront filters.
control('category-options').replaceChildren(...STANDARD_CATEGORIES.map(name => {
  const label = node('label'), box = node('input'); box.type = 'checkbox'; box.value = name; box.name = 'product-category';
  label.append(box, document.createTextNode(' ' + name.replace(/\b\w/g, letter => letter.toUpperCase()))); return label;
}));
const categoryBoxes = () => [...control('category-options').querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
function selectedCategories(): string[] {
  const other = input('product-categories').value.split(',').map(value => value.trim()).filter(Boolean);
  return [...new Set([...categoryBoxes().filter(box => box.checked).map(box => box.value), ...other])];
}
input('product-image').addEventListener('input', previewImage);
control('product-image-preview').addEventListener('error', () => { control('product-image-status').textContent = 'Image could not be loaded. Check that this asset is deployed.'; });
control('cancel-product').addEventListener('click', () => selectTab('products'));

function edit(product: AdminProduct | null): void {
  selectTab('editor'); control('tab-editor').textContent = product ? 'Edit product' : 'Add product';
  input('product-image').value = product?.image || ''; previewImage();
  editing = product; control('product-form').hidden = false; control('product-form-title').textContent = product ? `Edit ${product.sku}` : 'New product';
  input('product-sku').value = product?.sku || ''; input('product-sku').readOnly = Boolean(product);
  input('product-name').value = product?.name || ''; control<HTMLTextAreaElement>('product-description').value = product?.description || '';
  input('product-price').readOnly = product?.showcase === true;
  input('product-price').value = String(product?.price ?? 0); input('product-stock').value = String(product?.instock ?? 0);
  const categories = product?.categories || [];
  for (const box of categoryBoxes()) box.checked = categories.includes(box.value);
  input('product-categories').value = categories.filter(name => !STANDARD_CATEGORIES.includes(name)).join(', ');
  // Fields the server will refuse for this product are locked here instead of failing on save.
  input('product-stock').readOnly = Boolean(product) && !stockEditable; control('product-stock-help').hidden = !input('product-stock').readOnly;
  const locked = product?.showcase === true;
  input('product-image-file').disabled = locked; input('product-image').readOnly = locked; control<HTMLButtonElement>('product-image-remove').disabled = locked;
  control('image-upload-label').classList.toggle('disabled', locked);
  if (locked) notify('product-image-status', 'Reference product images change only through a reviewed provenance update.');
  input('product-archived').checked = product?.archived || false; notify('product-status', ''); input(product ? 'product-name' : 'product-sku').focus();
  productSnapshot = productState(); control('product-dirty').hidden = true;
}
const stockState = (product: AdminProduct) => product.archived ? 'archived' : product.available < 1 ? 'out' : product.available <= LOW_STOCK ? 'low' : 'active';
function renderAdminProducts(): void {
  const query = input('product-search').value.trim().toLowerCase(), status = control<HTMLSelectElement>('product-filter').value;
  const visible = adminProducts.filter(product => (!status || (status === 'active' ? !product.archived : stockState(product) === status)) && `${product.sku} ${product.name} ${product.categories.join(' ')}`.toLowerCase().includes(query));
  const counts = { active: 0, low: 0, out: 0, archived: 0 };
  for (const product of adminProducts) { const state = stockState(product); if (state !== 'archived') counts.active++; if (state !== 'active') counts[state]++; }
  for (const [id, value] of [['stat-total', adminProducts.length], ['stat-active', counts.active], ['stat-low', counts.low], ['stat-out', counts.out], ['stat-archived', counts.archived]] as const) control(id).textContent = String(value);
  control('product-count').textContent = `Showing ${visible.length} of ${adminProducts.length}`;
  const rows = visible.map(product => {
    const row = node('tr'); row.dataset.state = stockState(product);
    const name = node('td'); name.append(node('strong', product.name), node('small', product.categories.join(', ')));
    const price = node('td', product.priceType === 'on-request' ? 'Price on request' : `${product.currency || 'EUR'} ${product.price.toFixed(2)}${product.showcase ? ' reference' : ''}`); price.className = 'numeric';
    const stock = node('td', `${product.available} / ${product.instock}`); stock.className = 'numeric';
    const state = node('td'), labels = { active: ['Active', 'success'], low: ['Low stock', 'warning'], out: ['Sold out', 'danger'], archived: ['Archived', ''] } as const;
    const [label, tone] = labels[stockState(product)]; state.append(badge(label, tone));
    row.append(node('td', product.sku), name, price, stock, state);
    const action = node('td'), button = node('button', 'Edit'); button.className = 'button secondary'; button.setAttribute('aria-label', `Edit ${product.sku} details and image`); button.addEventListener('click', () => edit(product)); action.append(button); row.append(action); return row;
  });
  if (!rows.length) { const empty = node('td', adminProducts.length ? 'No products match these filters.' : 'No products yet. Create the first one.'); empty.colSpan = 6; empty.className = 'admin-empty'; const row = node('tr'); row.append(empty); rows.push(row); }
  control('admin-products').replaceChildren(...rows);
}
async function loadAdminProducts(): Promise<void> {
  const result = await adminRequest<{ products: AdminProduct[]; stockEditable?: boolean }>('/api/admin/products');
  adminProducts = result.products; stockEditable = result.stockEditable !== false;
  renderAdminProducts();
}
input('product-search').addEventListener('input', renderAdminProducts);
control('product-filter').addEventListener('change', renderAdminProducts);
async function loadUsers(append = false): Promise<void> {
  const result = await adminRequest<{ users: AdminUser[]; next: string | null }>('/api/admin/users' + (append && nextUsers ? `?after=${encodeURIComponent(nextUsers)}` : ''));
  const rows = result.users.map(user => {
    const row = node('div'); row.className = 'admin-user'; row.dataset.search = `${user.name} ${user.email}`.toLowerCase();
    const identity = node('div'); identity.className = 'admin-user-identity'; identity.append(node('strong', user.name), node('span', user.email)); row.append(identity, badge(user.role === 'superadmin' ? 'Super admin' : user.role === 'admin' ? 'Admin' : 'Customer', user.role === 'customer' ? '' : 'info'));
    if (user.disabled) row.append(badge('Disabled', 'danger'));
    const inspect = node('button', 'Customer details'); inspect.className = 'button secondary'; inspect.setAttribute('aria-expanded', 'false');
    const details = node('div'); details.className = 'customer-details'; details.hidden = true;
    inspect.addEventListener('click', async () => {
      if (details.dataset.loaded) { details.hidden = !details.hidden; inspect.setAttribute('aria-expanded', String(!details.hidden)); return; }
      details.replaceChildren(node('p', 'Loading customer details…')); details.hidden = false; inspect.disabled = true; inspect.setAttribute('aria-expanded', 'true');
      try {
        const [profile, history] = await Promise.all([
          adminRequest<{ activity: { lastLoginAt?: string; lastLoginIp?: string; loginCount?: number }; addresses: { address: { recipient: string; line1: string; postalCode: string }; city: { name: string; country: string } }[] }>(`/api/admin/users/${user.id}/profile`),
          adminRequest<{ purchases: { id: string; paidAt: string; total: number; currency: string }[]; next: string | null }>(`/api/admin/users/${user.id}/purchases`),
        ]);
        details.replaceChildren(); details.dataset.loaded = 'true';
        details.append(node('p', `Last login: ${profile.activity.lastLoginAt ? when(profile.activity.lastLoginAt) : 'Unavailable'} · IP: ${profile.activity.lastLoginIp || 'Unavailable'} · Logins: ${profile.activity.loginCount || 0}`));
        for (const item of profile.addresses) details.append(node('p', `${item.address.recipient} · ${item.address.line1} · ${item.city.name}, ${item.city.country} ${item.address.postalCode}`));
        function add(rows: { id: string; paidAt: string; total: number; currency: string }[]): void { for (const order of rows) details.append(node('p', `${when(order.paidAt)} · ${order.id} · ${amount(order.total, order.currency)}`)); }
        add(history.purchases); if (!history.purchases.length) details.append(node('p', 'No completed purchases.'));
        let cursor = history.next; const more = node('button', 'More purchases'); more.hidden = !cursor; details.append(more);
        more.addEventListener('click', async () => { more.disabled = true; try { const page = await adminRequest<typeof history>(`/api/admin/users/${user.id}/purchases?cursor=${encodeURIComponent(cursor || '')}`); add(page.purchases); cursor = page.next; more.hidden = !cursor; } catch (error) { notify('admin-status', message(error), 'error'); } finally { more.disabled = false; } });
      } catch (error) { details.replaceChildren(node('p', message(error))); }
      finally { inspect.disabled = false; }
    });
    row.append(inspect, details);
    if (user.role === 'superadmin') { row.append(node('span', 'Super admin · protected')); return row; }
    const role = node('select'); role.setAttribute('aria-label', `Role for ${user.email}`);
    for (const value of ['customer', 'admin']) role.append(new Option(value, value)); role.value = user.role;
    const label = node('label', ' Disabled '), disabled = node('input'); disabled.type = 'checkbox'; disabled.checked = user.disabled; label.append(disabled);
    const save = node('button', 'Save access'); save.className = 'button secondary';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await adminRequest(`/api/admin/users/${user.id}`, 'PATCH', { role: role.value, disabled: disabled.checked }); notify('admin-status', `Access updated for ${user.email}.`, 'success'); }
      catch (error) { notify('admin-status', message(error), 'error'); }
      finally { save.disabled = false; }
    });
    row.append(role, label, save); return row;
  });
  if (append) control('admin-users').append(...rows); else control('admin-users').replaceChildren(...rows);
  nextUsers = result.next; control('more-users').hidden = !nextUsers; filterUsers();
}
function filterUsers(): void {
  const query = input('user-search').value.trim().toLowerCase(), rows = [...control('admin-users').querySelectorAll<HTMLElement>('.admin-user')];
  for (const row of rows) row.hidden = !(row.dataset.search || '').includes(query);
  control('user-count').textContent = `Showing ${rows.filter(row => !row.hidden).length} of ${rows.length} loaded`;
}
input('user-search').addEventListener('input', filterUsers);
control('new-product').addEventListener('click', () => edit(null));
control('more-users').addEventListener('click', () => { void loadUsers(true).catch(error => notify('admin-status', message(error), 'error')); });
control('product-form').addEventListener('submit', async event => {
  event.preventDefault(); const save = control<HTMLButtonElement>('save-product'); save.disabled = true;
  try {
    if (!selectedCategories().length) throw new Error('Choose at least one category.');
    const product = { image: input('product-image').value.trim(), sku: input('product-sku').value, name: input('product-name').value, description: control<HTMLTextAreaElement>('product-description').value, price: Number(input('product-price').value), instock: Number(input('product-stock').value), categories: selectedCategories(), archived: input('product-archived').checked, ...(editing ? { revision: editing.revision } : {}) };
    await adminRequest(editing ? `/api/admin/products/${encodeURIComponent(editing.sku)}` : '/api/admin/products', editing ? 'PUT' : 'POST', product);
    await loadAdminProducts(); control('product-form').hidden = true; editing = null; control('tab-editor').textContent = 'Add product'; selectTab('products'); notify('admin-status', `Product ${product.sku} saved. The catalogue now uses this version.`, 'success');
  } catch (error) { notify('product-status', message(error), 'error'); }
  finally { save.disabled = false; }
});
control('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const save = control<HTMLButtonElement>('save-settings'); save.disabled = true;
  try { await adminRequest('/api/admin/settings', 'PUT', { storeName: input('setting-name').value, announcement: input('setting-announcement').value, supportEmail: input('setting-email').value, checkoutEnabled: input('setting-checkout').checked }); notify('settings-status', 'Settings saved.', 'success'); }
  catch (error) { notify('settings-status', message(error), 'error'); }
  finally { save.disabled = false; }
});
type LLMConfig = { provider: 'none' | 'bedrock' | 'ollama'; model?: string; region?: string; endpoint?: string; automaticFailover?: boolean; fallback?: LLMConfig };
interface LLMState { config: LLMConfig; revision: number; status: string; verifiedAt?: string; endpoints: string[] }
let llmRevision = 0;
function llmFields(): void {
  const provider = control<HTMLSelectElement>('llm-provider').value;
  control('llm-region-field').hidden = provider !== 'bedrock';
  control('llm-endpoint-field').hidden = provider !== 'ollama';
  control('llm-model-field').hidden = provider === 'none';
  control('llm-fallback-fields').hidden = provider !== 'ollama';
}
function displayLLM(state: LLMState): void {
  llmRevision = state.revision;
  control<HTMLSelectElement>('llm-provider').value = state.config.provider;
  input('llm-model').value = state.config.model || '';
  input('llm-region').value = state.config.region || '';
  input('llm-failover').checked = state.config.automaticFailover === true;
  input('llm-fallback-region').value = state.config.fallback?.region || '';
  input('llm-fallback-model').value = state.config.fallback?.model || '';
  control<HTMLSelectElement>('llm-endpoint').replaceChildren(...state.endpoints.map(alias => new Option(alias, alias)));
  control<HTMLSelectElement>('llm-endpoint').value = state.config.endpoint || state.endpoints[0] || '';
  control('llm-current').textContent = `${state.config.provider} · ${state.config.model || 'No model'} · ${state.status} · revision ${state.revision}` + (state.verifiedAt ? ` · Last verified ${state.verifiedAt}` : '');
  llmFields();
}
async function loadLLM(): Promise<void> { displayLLM(await adminRequest<LLMState>('/api/admin/llm')); }
function proposedLLM(): LLMConfig {
  const provider = control<HTMLSelectElement>('llm-provider').value as LLMConfig['provider'];
  if (provider === 'none') return { provider };
  const config: LLMConfig = { provider, model: input('llm-model').value.trim() };
  if (provider === 'bedrock') return { ...config, region: input('llm-region').value.trim() };
  config.endpoint = control<HTMLSelectElement>('llm-endpoint').value;
  if (input('llm-failover').checked) {
    config.automaticFailover = true;
    config.fallback = {
      provider: 'bedrock',
      region: input('llm-fallback-region').value.trim(),
      model: input('llm-fallback-model').value.trim(),
    };
  }
  return config;
}
async function llmAction(action: 'test' | 'save' | 'disconnect' | 'refresh'): Promise<void> {
  const buttons = ['llm-test', 'llm-save', 'llm-disconnect', 'llm-refresh'].map(id => control<HTMLButtonElement>(id));
  buttons.forEach(b => b.disabled = true); notify('llm-status', 'Working…');
  try {
    if (action === 'refresh') { await loadLLM(); control('llm-status').textContent = 'Configuration refreshed.'; return; }
    if (action === 'test') {
      await adminRequest('/api/admin/llm/test', 'POST', { revision: llmRevision, config: proposedLLM() });
      control('llm-status').textContent = 'Connection successful. Active configuration has not changed.';
    } else {
      const state = await adminRequest<LLMState>(action === 'disconnect' ? '/api/admin/llm/disconnect' : '/api/admin/llm', action === 'disconnect' ? 'POST' : 'PUT', { revision: llmRevision, ...(action === 'save' ? { config: proposedLLM() } : {}) });
      displayLLM(state); control('llm-status').textContent = state.config.provider === 'none' ? 'AI disconnected. Ollama infrastructure has not been stopped or deleted.' : state.config.automaticFailover ? 'Both providers tested. Automatic failover activated.' : 'Configuration saved. Use Test connection to check provider availability.';
    }
  } catch (error) { notify('llm-status', message(error), 'error'); }
  finally { buttons.forEach(b => b.disabled = false); }
}
control('llm-provider').addEventListener('change', llmFields);
control('llm-form').addEventListener('submit', event => { event.preventDefault(); void llmAction('save'); });
for (const action of ['test', 'disconnect', 'refresh'] as const) control(`llm-${action}`).addEventListener('click', () => { void llmAction(action); });

async function loadOverview(): Promise<void> {
  try {
    const overview = await adminRequest<{ reviews?: { pending: number }; orders?: { needsAttention: number } }>('/api/admin/overview');
    const count = (id: string, label: string, value?: number) => { control(id).textContent = value ? `${label} · ${value}` : label; if (value) control(id).setAttribute('aria-label', `${label}, ${value} need attention`); };
    count('tab-reviews', 'Reviews', overview.reviews?.pending); count('tab-orders', 'Orders', overview.orders?.needsAttention);
  } catch { /* Counts are a convenience; each tab still loads its own data. */ }
}

interface OrderSummary { id: string; status: string; paymentMode: string; createdAt?: string; paidAt?: string; currency?: string; total?: number; items: { sku: string; name?: string; quantity: number }[]; shipping: { recipient?: string; city?: string; country?: string }; demo?: boolean }
const ORDER_TONES: Record<string, string> = { paid: 'success', payment_review: 'warning', payment_pending: 'info', creating: 'info', failed: 'danger', expired: '', cancelled: '' };
let orderOffset = 0, orderSearchTimer: ReturnType<typeof setTimeout> | undefined;
async function loadOrders(append = false): Promise<void> {
  if (!append) orderOffset = 0;
  try {
    const query = new URLSearchParams({ mode: control<HTMLSelectElement>('order-mode').value, status: control<HTMLSelectElement>('order-status').value, q: input('order-search').value.trim(), offset: String(orderOffset), limit: '25' });
    const [result, test] = await Promise.all([
      adminRequest<{ orders: OrderSummary[]; total: number }>('/api/admin/orders?' + query),
      control<HTMLSelectElement>('order-mode').value === 'live' ? Promise.resolve({ orders: [] }) : adminRequest<{ orders: { id: string; revision: number }[] }>('/api/admin/test-orders'),
    ]);
    const revisions = new Map(test.orders.map(order => [order.id, order.revision]));
    const rows = result.orders.map(order => {
      const row = node('tr'), id = node('td'); id.append(node('strong', order.id.slice(0, 8)), node('small', order.paymentMode === 'test' ? 'Test order' : 'Live order')); id.title = order.id;
      const items = node('td', order.items.map(item => `${item.quantity} × ${item.name || item.sku}`).join(', '));
      const total = node('td', amount(order.total, order.currency)); total.className = 'numeric';
      const status = node('td'); status.append(badge(order.status.replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase()), ORDER_TONES[order.status] ?? ''));
      const customer = node('td'); customer.append(node('strong', order.shipping.recipient || '—'), node('small', [order.shipping.city, order.shipping.country].filter(Boolean).join(', ')));
      const action = node('td'), revision = revisions.get(order.id);
      if (order.paymentMode === 'test' && revision !== undefined && order.status !== 'paid') {
        const reconcile = node('button', 'Reconcile'); reconcile.className = 'button secondary';
        reconcile.addEventListener('click', async () => {
          const reason = prompt('Reason for reconciling this test order (10–500 characters):', '')?.trim();
          if (!reason) return;
          if (reason.length < 10) { notify('admin-status', 'Give a reconciliation reason of at least 10 characters.', 'error'); return; }
          reconcile.disabled = true;
          try { const updated = await adminRequest<{ status: string }>(`/api/admin/test-orders/${order.id}/reconcile`, 'POST', { reason, revision }); notify('admin-status', `Order ${order.id.slice(0, 8)} reconciled: ${updated.status.replace(/_/g, ' ')}.`, 'success'); await loadOrders(); }
          catch (error) { notify('admin-status', message(error), 'error'); reconcile.disabled = false; }
        });
        action.append(reconcile);
      }
      row.append(id, node('td', when(order.paidAt || order.createdAt)), customer, items, total, status, action); return row;
    });
    if (!append && !rows.length) { const empty = node('td', 'No orders match these filters.'); empty.colSpan = 7; empty.className = 'admin-empty'; const row = node('tr'); row.append(empty); rows.push(row); }
    if (append) control('admin-orders').append(...rows); else control('admin-orders').replaceChildren(...rows);
    orderOffset += result.orders.length;
    control('order-count').textContent = `Showing ${Math.min(orderOffset, result.total)} of ${result.total}`;
    control('more-orders').hidden = orderOffset >= result.total;
  } catch (error) { notify('admin-status', message(error), 'error'); }
}
for (const id of ['order-mode', 'order-status']) control(id).addEventListener('change', () => { void loadOrders(); });
input('order-search').addEventListener('input', () => { clearTimeout(orderSearchTimer); orderSearchTimer = setTimeout(() => { void loadOrders(); }, 300); });
control('more-orders').addEventListener('click', () => { void loadOrders(true); });

interface AuditEntry { at: string; action: string; target?: string | null; actor: { email?: string; role?: string }; outcome: string; status: number; fields: string[]; values: Record<string, unknown> }
const AUDIT_LABELS: Record<string, string> = { 'product.create': 'Created product', 'product.update': 'Updated product', 'product.image_upload': 'Uploaded product image', 'user.access': 'Changed user access', 'settings.update': 'Updated store settings', 'review.moderate': 'Moderated review', 'llm.save': 'Saved AI settings', 'llm.test': 'Tested AI connection', 'llm.disconnect': 'Disconnected AI', 'order.reconcile': 'Reconciled test order' };
let auditOffset = 0;
async function loadAudit(append = false): Promise<void> {
  if (!append) auditOffset = 0;
  try {
    const query = new URLSearchParams({ action: control<HTMLSelectElement>('audit-action').value, outcome: control<HTMLSelectElement>('audit-outcome').value, offset: String(auditOffset), limit: '50' });
    const { entries, total } = await adminRequest<{ entries: AuditEntry[]; total: number }>('/api/admin/audit?' + query);
    const rows = entries.map(entry => {
      const row = node('tr'), who = node('td'); who.append(node('strong', entry.actor.email || 'Unknown'), node('small', entry.actor.role || ''));
      const changed = Object.entries(entry.values).map(([key, value]) => `${key}: ${String(value)}`);
      const outcome = node('td'); outcome.append(badge(entry.outcome === 'success' ? 'Succeeded' : `Refused (${entry.status})`, entry.outcome === 'success' ? 'success' : 'danger'));
      row.append(node('td', when(entry.at)), who, node('td', AUDIT_LABELS[entry.action] || entry.action), node('td', entry.target || '—'), node('td', [...changed, ...entry.fields.filter(field => !(field in entry.values))].join(', ') || '—'), outcome); return row;
    });
    if (!append && !rows.length) { const empty = node('td', 'No activity recorded yet.'); empty.colSpan = 6; empty.className = 'admin-empty'; const row = node('tr'); row.append(empty); rows.push(row); }
    if (append) control('admin-audit').append(...rows); else control('admin-audit').replaceChildren(...rows);
    auditOffset += entries.length; control('more-audit').hidden = auditOffset >= total;
  } catch (error) { notify('admin-status', message(error), 'error'); }
}
for (const id of ['audit-action', 'audit-outcome']) control(id).addEventListener('change', () => { void loadAudit(); });
control('more-audit').addEventListener('click', () => { void loadAudit(true); });

try {
  const { user } = await adminRequest<{ user: AdminUser | null }>('/api/auth/me');
  if (!user || user.role === 'customer') throw new Error('An admin or super admin account is required.');
  control('admin-content').hidden = false; control('admin-status').textContent = '';
  control('admin-identity').textContent = `Signed in as ${user.name} · ${user.role === 'superadmin' ? 'Super admin' : 'Admin'}`; control('admin-identity').hidden = false;
  selectTab('products');
  await loadAdminProducts();
  void loadOverview();
  if (user.role === 'superadmin') {
    for (const key of ['llm', 'users', 'settings', 'orders', 'audit']) control(`tab-${key}`).hidden = false;
    void loadLLM().catch(error => { control('llm-status').textContent = message(error); });
    const [settings] = await Promise.all([adminRequest<Settings>('/api/admin/settings'), loadUsers()]);
    input('setting-name').value = settings.storeName; input('setting-announcement').value = settings.announcement; input('setting-email').value = settings.supportEmail; input('setting-checkout').checked = settings.checkoutEnabled;
  }
} catch (error) { control('admin-content').hidden = true; control('admin-login').hidden = false; notify('admin-status', message(error), 'error'); }

async function moderateList(append = false): Promise<void> {
  try {
    const result = await adminRequest<{ reviews: { id: string; productId: string; title: string; body: string; status: string; synthetic: boolean }[]; next: string | null }>('/api/admin/reviews?' + new URLSearchParams({ kind: control<HTMLSelectElement>('moderation-kind').value, after: append ? reviewCursor || '' : '' }));
    if (!append) control('moderation-list').replaceChildren();
    const tones: Record<string, string> = { published: 'success', hidden: 'danger', pending: 'warning' };
    for (const review of result.reviews) {
      const row = node('article'); row.className = 'review admin-review';
      const meta = node('div'); meta.className = 'admin-review-meta'; meta.append(badge(review.status.charAt(0).toUpperCase() + review.status.slice(1), tones[review.status] || '')); if (review.synthetic) meta.append(badge('Synthetic')); meta.append(node('span', adminProducts.find(product => product.sku === review.productId)?.name || review.productId));
      const actions = node('div'); actions.className = 'admin-review-actions';
      for (const status of ['published', 'hidden', 'pending']) { const button = node('button', `Set ${status}`); button.className = 'button secondary'; button.disabled = review.status === status; button.addEventListener('click', async () => { button.disabled = true; try { await adminRequest('/api/admin/reviews/' + encodeURIComponent(review.id), 'PATCH', { status }); notify('admin-status', `Review “${review.title}” set to ${status}.`, 'success'); await moderateList(); } catch (error) { notify('admin-status', message(error), 'error'); button.disabled = false; } }); actions.append(button); }
      row.append(meta, node('h3', review.title), node('p', review.body), actions);
      control('moderation-list').append(row);
    }
    if (!control('moderation-list').childElementCount) control('moderation-list').append(node('p', 'No reviews in this dataset.'));
    reviewCursor = result.next; control('more-moderation').hidden = !reviewCursor;
  } catch (error) { notify('admin-status', message(error), 'error'); }
}
control('load-reviews').addEventListener('click', () => { void moderateList(); });
control('moderation-kind').addEventListener('change', () => { void moderateList(); });
control('more-moderation').addEventListener('click', () => { void moderateList(true); });

