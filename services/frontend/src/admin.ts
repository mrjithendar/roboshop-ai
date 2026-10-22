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
async function adminRequest<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(appPath(path), { method, headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) {
    if ([401, 403].includes(response.status)) { control('admin-content').hidden = true; control('admin-login').hidden = false; control('admin-status').textContent = 'Your account no longer has access to this action. Log in again.'; }
    throw new Error((result.error || 'Request failed.') + (result.requestId ? ` (Request ${result.requestId})` : ''));
  }
  return result;
}
let editing: AdminProduct | null = null, nextUsers: string | null = null;
const tabNames = ['products', 'editor', 'reviews', 'users', 'settings', 'llm'];
function selectTab(name: string): void {
  if (control(`tab-${name}`).hidden) return;
  for (const key of tabNames) {
    const active = name === key;
    control(`tab-${key}`).setAttribute('aria-selected', String(active));
    control(`tab-${key}`).tabIndex = active ? 0 : -1;
    control(`panel-${key}`).hidden = !active;
  }
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
function previewImage(): void {
  const path = input('product-image').value.trim();
  const preview = control<HTMLImageElement>('product-image-preview');
  const valid = /^\/(?:product-media|images)\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(path);
  preview.hidden = !valid;
  control('product-image-status').textContent = path && !valid ? 'Enter a storefront image path ending in .jpg, .jpeg, .png or .webp.' : '';
  if (valid) preview.src = appPath(path);
  else preview.removeAttribute('src');
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
  input('product-price').value = String(product?.price ?? 0); input('product-stock').value = String(product?.instock ?? 0); input('product-categories').value = product?.categories.join(', ') || '';
  input('product-archived').checked = product?.archived || false; control('product-status').textContent = ''; input('product-name').focus();
}
async function loadAdminProducts(): Promise<void> {
  const { products } = await adminRequest<{ products: AdminProduct[] }>('/api/admin/products');
  control('admin-products').replaceChildren(...products.map(product => {
    const row = node('tr');
    for (const value of [product.sku, product.name, product.priceType === 'on-request' ? 'Price on request' : `${product.currency || 'EUR'} ${product.price.toFixed(2)}${product.showcase ? ' reference' : ''}`, `${product.available} / ${product.instock}`, product.archived ? 'Archived' : 'Active']) row.append(node('td', value));
    const action = node('td'), button = node('button', 'Edit details / image'); button.className = 'button secondary'; button.addEventListener('click', () => edit(product)); action.append(button); row.append(action); return row;
  }));
}
async function loadUsers(append = false): Promise<void> {
  const result = await adminRequest<{ users: AdminUser[]; next: string | null }>('/api/admin/users' + (append && nextUsers ? `?after=${encodeURIComponent(nextUsers)}` : ''));
  const rows = result.users.map(user => {
    const row = node('div'); row.className = 'admin-user'; row.append(node('strong', user.name), node('span', user.email));
    const inspect = node('button', 'Customer details'); inspect.className = 'button secondary';
    const details = node('div'); details.className = 'customer-details'; details.hidden = true;
    inspect.addEventListener('click', async () => {
      details.replaceChildren(); details.hidden = false; inspect.disabled = true;
      try {
        const [profile, history] = await Promise.all([
          adminRequest<{ activity: { lastLoginAt?: string; lastLoginIp?: string; loginCount?: number }; addresses: { address: { recipient: string; line1: string; postalCode: string }; city: { name: string; country: string } }[] }>(`/api/admin/users/${user.id}/profile`),
          adminRequest<{ purchases: { id: string; paidAt: string; total: number; currency: string }[]; next: string | null }>(`/api/admin/users/${user.id}/purchases`),
        ]);
        details.append(node('p', `Last login: ${profile.activity.lastLoginAt || 'Unavailable'} · IP: ${profile.activity.lastLoginIp || 'Unavailable'} · Logins: ${profile.activity.loginCount || 0}`));
        for (const item of profile.addresses) details.append(node('p', `${item.address.recipient} · ${item.address.line1} · ${item.city.name}, ${item.city.country} ${item.address.postalCode}`));
        function add(rows: { id: string; paidAt: string; total: number; currency: string }[]): void { for (const order of rows) details.append(node('p', `${order.paidAt} · ${order.id} · ${order.currency} ${order.total.toFixed(2)}`)); }
        add(history.purchases); if (!history.purchases.length) details.append(node('p', 'No completed purchases.'));
        let cursor = history.next; const more = node('button', 'More purchases'); more.hidden = !cursor; details.append(more);
        more.addEventListener('click', async () => { more.disabled = true; try { const page = await adminRequest<typeof history>(`/api/admin/users/${user.id}/purchases?cursor=${encodeURIComponent(cursor || '')}`); add(page.purchases); cursor = page.next; more.hidden = !cursor; } catch (error) { control('admin-status').textContent = message(error); } finally { more.disabled = false; } });
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
      try { await adminRequest(`/api/admin/users/${user.id}`, 'PATCH', { role: role.value, disabled: disabled.checked }); control('admin-status').textContent = `Access updated for ${user.email}.`; }
      catch (error) { control('admin-status').textContent = message(error); }
      finally { save.disabled = false; }
    });
    row.append(role, label, save); return row;
  });
  if (append) control('admin-users').append(...rows); else control('admin-users').replaceChildren(...rows);
  nextUsers = result.next; control('more-users').hidden = !nextUsers;
}
control('new-product').addEventListener('click', () => edit(null));
control('more-users').addEventListener('click', () => { void loadUsers(true).catch(error => control('admin-status').textContent = message(error)); });
control('product-form').addEventListener('submit', async event => {
  event.preventDefault(); const save = control<HTMLButtonElement>('save-product'); save.disabled = true;
  try {
    const product = { image: input('product-image').value.trim(), sku: input('product-sku').value, name: input('product-name').value, description: control<HTMLTextAreaElement>('product-description').value, price: Number(input('product-price').value), instock: Number(input('product-stock').value), categories: input('product-categories').value.split(',').map(value => value.trim()).filter(Boolean), archived: input('product-archived').checked, ...(editing ? { revision: editing.revision } : {}) };
    await adminRequest(editing ? `/api/admin/products/${encodeURIComponent(editing.sku)}` : '/api/admin/products', editing ? 'PUT' : 'POST', product);
    await loadAdminProducts(); control('product-form').hidden = true; editing = null; control('tab-editor').textContent = 'Add product'; selectTab('products'); control('admin-status').textContent = 'Product saved. The catalogue now uses this version.';
  } catch (error) { control('product-status').textContent = message(error); }
  finally { save.disabled = false; }
});
control('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const save = control<HTMLButtonElement>('save-settings'); save.disabled = true;
  try { await adminRequest('/api/admin/settings', 'PUT', { storeName: input('setting-name').value, announcement: input('setting-announcement').value, supportEmail: input('setting-email').value, checkoutEnabled: input('setting-checkout').checked }); control('settings-status').textContent = 'Settings saved.'; }
  catch (error) { control('settings-status').textContent = message(error); }
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
  buttons.forEach(b => b.disabled = true); control('llm-status').textContent = 'Working…';
  try {
    if (action === 'refresh') { await loadLLM(); control('llm-status').textContent = 'Configuration refreshed.'; return; }
    if (action === 'test') {
      await adminRequest('/api/admin/llm/test', 'POST', { revision: llmRevision, config: proposedLLM() });
      control('llm-status').textContent = 'Connection successful. Active configuration has not changed.';
    } else {
      const state = await adminRequest<LLMState>(action === 'disconnect' ? '/api/admin/llm/disconnect' : '/api/admin/llm', action === 'disconnect' ? 'POST' : 'PUT', { revision: llmRevision, ...(action === 'save' ? { config: proposedLLM() } : {}) });
      displayLLM(state); control('llm-status').textContent = state.config.provider === 'none' ? 'AI disconnected. Ollama infrastructure has not been stopped or deleted.' : state.config.automaticFailover ? 'Both providers tested. Automatic failover activated.' : 'Configuration saved. Use Test connection to check provider availability.';
    }
  } catch (error) { control('llm-status').textContent = message(error); }
  finally { buttons.forEach(b => b.disabled = false); }
}
control('llm-provider').addEventListener('change', llmFields);
control('llm-form').addEventListener('submit', event => { event.preventDefault(); void llmAction('save'); });
for (const action of ['test', 'disconnect', 'refresh'] as const) control(`llm-${action}`).addEventListener('click', () => { void llmAction(action); });

try {
  const { user } = await adminRequest<{ user: AdminUser | null }>('/api/auth/me');
  if (!user || user.role === 'customer') throw new Error('An admin or super admin account is required.');
  control('admin-content').hidden = false; control('admin-status').textContent = `Signed in as ${user.name} · ${user.role}`;
  selectTab('products');
  await loadAdminProducts();
  if (user.role === 'superadmin') {
    for (const key of ['llm', 'users', 'settings']) control(`tab-${key}`).hidden = false;
    void loadLLM().catch(error => { control('llm-status').textContent = message(error); });
    const [settings] = await Promise.all([adminRequest<Settings>('/api/admin/settings'), loadUsers()]);
    input('setting-name').value = settings.storeName; input('setting-announcement').value = settings.announcement; input('setting-email').value = settings.supportEmail; input('setting-checkout').checked = settings.checkoutEnabled;
  }
} catch (error) { control('admin-content').hidden = true; control('admin-login').hidden = false; control('admin-status').textContent = message(error); }

let reviewCursor: string | null = null;
async function moderateList(append = false): Promise<void> {
  try {
    const result = await adminRequest<{ reviews: { id: string; productId: string; title: string; body: string; status: string; synthetic: boolean }[]; next: string | null }>('/api/admin/reviews?' + new URLSearchParams({ kind: control<HTMLSelectElement>('moderation-kind').value, after: append ? reviewCursor || '' : '' }));
    if (!append) control('moderation-list').replaceChildren();
    for (const review of result.reviews) {
      const row = node('article'); row.className = 'review'; row.append(node('h3', `${review.productId}: ${review.title}`), node('p', review.body), node('p', `${review.synthetic ? 'Synthetic · ' : ''}${review.status}`));
      for (const status of ['published', 'hidden', 'pending']) { const button = node('button', `Set ${status}`); button.addEventListener('click', async () => { button.disabled = true; try { await adminRequest('/api/admin/reviews/' + encodeURIComponent(review.id), 'PATCH', { status }); await moderateList(); } catch (error) { control('admin-status').textContent = message(error); } finally { button.disabled = false; } }); row.append(button); }
      control('moderation-list').append(row);
    }
    reviewCursor = result.next; control('more-moderation').hidden = !reviewCursor;
  } catch (error) { control('admin-status').textContent = message(error); }
}
control('load-reviews').addEventListener('click', () => { void moderateList(); });
control('moderation-kind').addEventListener('change', () => { void moderateList(); });
control('more-moderation').addEventListener('click', () => { void moderateList(true); });
