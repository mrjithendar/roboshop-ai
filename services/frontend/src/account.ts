import { appPath } from './paths.js';
declare global { interface Window { turnstile?: { render(container: HTMLElement, options: Record<string, unknown>): string; reset(id: string): void; getResponse(id: string): string; remove(id: string): void } } }
export interface User { id: string; email: string; name: string; role: 'customer' | 'admin' | 'superadmin'; disabled: boolean }
export let currentUser: User | null = null;
export function loginPath(): string {
  return appPath('/login') + '?returnTo=' + encodeURIComponent(location.pathname + location.search + location.hash);
}
export function showLogin(): void { location.assign(loginPath()); }
export async function accountRequest(path: string, data?: object): Promise<{ user: User | null }> {
  const response = await fetch(appPath(path), { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Account service unavailable.');
  return result;
}
export async function initAccount(changed: () => Promise<void>): Promise<void> {
  const account = document.getElementById('account-button') as HTMLAnchorElement;
  const logout = document.getElementById('logout-button') as HTMLButtonElement;
  const admin = document.getElementById('admin-link');
  const render = () => {
    account.textContent = currentUser ? 'Account' : 'Sign in';
    account.href = currentUser ? appPath('/account') : loginPath();
    logout.hidden = !currentUser;
    if (admin) admin.hidden = !currentUser || currentUser.role === 'customer';
  };
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try { await accountRequest('/api/auth/logout', {}); currentUser = null; render(); await changed(); }
    catch { logout.textContent = 'Retry sign out'; }
    finally { logout.disabled = false; }
  });
  try { currentUser = (await accountRequest('/api/auth/me')).user; }
  catch { currentUser = null; }
  render();
  if (!currentUser && new URLSearchParams(location.search).has('login')) showLogin();
}
