export {};
interface AdminProduct { sku: string; name: string; description: string; price: number; instock: number; categories: string[]; archived: boolean; revision: number; available: number }
interface AdminUser { id: string; name: string; email: string; role: 'customer' | 'admin' | 'superadmin'; disabled: boolean }
interface Settings { storeName: string; announcement: string; supportEmail: string; checkoutEnabled: boolean }
const control = <T extends HTMLElement>(id: string): T => { const node = document.getElementById(id); if (!node) throw new Error(`Missing control ${id}`); return node as T; };
const input = (id: string) => control<HTMLInputElement>(id);
const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, content = ''): HTMLElementTagNameMap[K] => { const result = document.createElement(tag); result.textContent = content; return result; };
async function adminRequest<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) {
    if ([401, 403].includes(response.status)) { control('admin-content').hidden = true; control('admin-login').hidden = false; control('admin-status').textContent = 'Your account no longer has access to this action. Log in again.'; }
    throw new Error(result.error || 'Request failed.');
  }
  return result;
}
let editing: AdminProduct | null = null, nextUsers: string | null = null;
function edit(product: AdminProduct | null): void {
  editing = product; control('product-form').hidden = false; control('product-form-title').textContent = product ? `Edit ${product.sku}` : 'New product';
  input('product-sku').value = product?.sku || ''; input('product-sku').readOnly = Boolean(product);
  input('product-name').value = product?.name || ''; control<HTMLTextAreaElement>('product-description').value = product?.description || '';
  input('product-price').value = String(product?.price ?? 0); input('product-stock').value = String(product?.instock ?? 0); input('product-categories').value = product?.categories.join(', ') || '';
  input('product-archived').checked = product?.archived || false; control('product-status').textContent = ''; input('product-name').focus();
}
async function loadAdminProducts(): Promise<void> {
  const { products } = await adminRequest<{ products: AdminProduct[] }>('/api/admin/products');
  control('admin-products').replaceChildren(...products.map(product => {
    const row = node('tr');
    for (const value of [product.sku, product.name, `€${product.price.toFixed(2)}`, `${product.available} / ${product.instock}`, product.archived ? 'Archived' : 'Active']) row.append(node('td', value));
    const action = node('td'), button = node('button', 'Edit'); button.className = 'button secondary'; button.addEventListener('click', () => edit(product)); action.append(button); row.append(action); return row;
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
    const product = { sku: input('product-sku').value, name: input('product-name').value, description: control<HTMLTextAreaElement>('product-description').value, price: Number(input('product-price').value), instock: Number(input('product-stock').value), categories: input('product-categories').value.split(',').map(value => value.trim()).filter(Boolean), archived: input('product-archived').checked, ...(editing ? { revision: editing.revision } : {}) };
    await adminRequest(editing ? `/api/admin/products/${encodeURIComponent(editing.sku)}` : '/api/admin/products', editing ? 'PUT' : 'POST', product);
    await loadAdminProducts(); control('product-form').hidden = true; editing = null; control('admin-status').textContent = 'Product saved. The catalogue now uses this version.';
  } catch (error) { control('product-status').textContent = message(error); }
  finally { save.disabled = false; }
});
control('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const save = control<HTMLButtonElement>('save-settings'); save.disabled = true;
  try { await adminRequest('/api/admin/settings', 'PUT', { storeName: input('setting-name').value, announcement: input('setting-announcement').value, supportEmail: input('setting-email').value, checkoutEnabled: input('setting-checkout').checked }); control('settings-status').textContent = 'Settings saved.'; }
  catch (error) { control('settings-status').textContent = message(error); }
  finally { save.disabled = false; }
});
try {
  const { user } = await adminRequest<{ user: AdminUser | null }>('/api/auth/me');
  if (!user || user.role === 'customer') throw new Error('An admin or super admin account is required.');
  control('admin-content').hidden = false; control('admin-status').textContent = `Signed in as ${user.name} · ${user.role}`;
  await loadAdminProducts();
  if (user.role === 'superadmin') {
    control('users-section').hidden = false; control('settings-section').hidden = false;
    const [settings] = await Promise.all([adminRequest<Settings>('/api/admin/settings'), loadUsers()]);
    input('setting-name').value = settings.storeName; input('setting-announcement').value = settings.announcement; input('setting-email').value = settings.supportEmail; input('setting-checkout').checked = settings.checkoutEnabled;
  }
} catch (error) { control('admin-content').hidden = true; control('admin-login').hidden = false; control('admin-status').textContent = message(error); }
