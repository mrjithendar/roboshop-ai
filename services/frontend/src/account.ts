export interface User { id: string; email: string; name: string; role: 'customer' | 'admin' | 'superadmin'; disabled: boolean }
export let currentUser: User | null = null;
const accountElement = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing account control: ${id}`);
  return node as T;
};
export function showLogin(): void { const dialog = accountElement<HTMLDialogElement>('account-dialog'); if (!dialog.open) dialog.showModal(); }
export async function initAccount(changed: () => Promise<void>): Promise<void> {
  const form = accountElement<HTMLFormElement>('account-form');
  const mode = accountElement<HTMLSelectElement>('account-mode');
  const status = accountElement<HTMLElement>('account-status');
  const render = () => {
    accountElement('account-button').textContent = currentUser ? currentUser.name : 'Log in';
    accountElement('logout-button').hidden = !currentUser;
    accountElement('admin-link').hidden = !currentUser || currentUser.role === 'customer';
  };
  async function accountRequest(path: string, data?: object): Promise<{ user: User | null }> {
    const response = await fetch(path, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account service unavailable.');
    return result;
  }
  accountElement('account-button').addEventListener('click', () => {
    status.textContent = currentUser ? `Signed in as ${currentUser.email} (${currentUser.role}).` : '';
    showLogin();
  });
  mode.addEventListener('change', () => {
    const registering = mode.value === 'register';
    accountElement('account-name-label').hidden = !registering;
    accountElement<HTMLInputElement>('account-name').required = registering;
    accountElement<HTMLInputElement>('account-password').autocomplete = registering ? 'new-password' : 'current-password';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = accountElement<HTMLButtonElement>('account-submit'); button.disabled = true; status.textContent = 'Please wait…';
    try {
      const data = { email: accountElement<HTMLInputElement>('account-email').value, password: accountElement<HTMLInputElement>('account-password').value, ...(mode.value === 'register' ? { name: accountElement<HTMLInputElement>('account-name').value } : {}) };
      currentUser = (await accountRequest(`/api/auth/${mode.value === 'register' ? 'register' : 'login'}`, data)).user;
      accountElement<HTMLInputElement>('account-password').value = ''; render();
      accountElement<HTMLDialogElement>('account-dialog').close();
      await changed();
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Login failed.'; }
    finally { button.disabled = false; }
  });
  accountElement('logout-button').addEventListener('click', async () => {
    try { await accountRequest('/api/auth/logout', {}); currentUser = null; render(); accountElement<HTMLDialogElement>('account-dialog').close(); await changed(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : 'Logout failed.'; showLogin(); }
  });
  try { currentUser = (await accountRequest('/api/auth/me')).user; }
  catch { currentUser = null; status.textContent = 'Account service unavailable. Please try again.'; }
  render();
  if (!currentUser && new URLSearchParams(location.search).has('login')) showLogin();
}
