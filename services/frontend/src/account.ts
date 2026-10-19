import { appPath } from './paths.js';
declare global { interface Window { turnstile?: { render(container: HTMLElement, options: Record<string, unknown>): string; reset(id: string): void; getResponse(id: string): string; remove(id: string): void } } }
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
    form.hidden = Boolean(currentUser);
    accountElement('account-details').hidden = !currentUser;
    if (!currentUser) accountElement('account-details').replaceChildren();
    accountElement('admin-link').hidden = !currentUser || currentUser.role === 'customer';
  };
  async function accountRequest(path: string, data?: object): Promise<{ user: User | null }> {
    const response = await fetch(appPath(path), { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account service unavailable.');
    return result;
  }
  const privateText = (tag: string, value: string): HTMLElement => { const el = document.createElement(tag); el.textContent = value; return el; };
  let accountGeneration = 0;
  async function loadAccount(): Promise<void> {
    const userId = currentUser?.id, generation = ++accountGeneration;
    if (!userId) return;
    const panel = accountElement('account-details'); panel.replaceChildren(privateText('p', 'Loading your account…'));
    async function read<T>(path: string): Promise<T> {
      const response = await fetch(appPath(path), { signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Account details unavailable.'); return data;
    }
    interface Purchase { id: string; total: number; currency: string; paidAt: string; items: { name: string; quantity: number }[] }
    try {
      const [profile, activity, history] = await Promise.all([
        read<{ activity: { lastLoginAt?: string; lastLoginIp?: string; loginCount?: number }; addresses: { address: { recipient: string; line1: string; postalCode: string }; city: { name: string; country: string } }[] }>('/api/account/profile'),
        read<{ retentionDays: number; events: { occurredAt: string; ipAddress: string; userAgent: string }[] }>('/api/account/activity'),
        read<{ purchases: Purchase[]; next: string | null }>('/api/account/purchases'),
      ]);
      if (currentUser?.id !== userId || generation !== accountGeneration) return;
      panel.replaceChildren(privateText('h3', 'Account activity'), privateText('p', `Last login: ${profile.activity.lastLoginAt ? new Date(profile.activity.lastLoginAt).toLocaleString() : 'Unavailable'} · IP: ${profile.activity.lastLoginIp || 'Unavailable'}`));
      panel.append(privateText('h3', 'Saved delivery addresses'));
      for (const item of profile.addresses) panel.append(privateText('p', `${item.address.recipient} · ${item.address.line1} · ${item.city.name}, ${item.city.country} ${item.address.postalCode}`));
      if (!profile.addresses.length) panel.append(privateText('p', 'No delivery addresses saved yet.'));
      panel.append(privateText('h3', 'Purchase history'));
      const purchases = document.createElement('div'); panel.append(purchases);
      function appendPurchases(rows: Purchase[]): void { for (const order of rows) purchases.append(privateText('p', `${new Date(order.paidAt).toLocaleDateString()} · ${order.id} · ${order.currency} ${order.total.toFixed(2)} · ${order.items.map(item => `${item.name} × ${item.quantity}`).join(', ')}`)); }
      appendPurchases(history.purchases);
      if (!history.purchases.length) purchases.append(privateText('p', 'No completed purchases yet. Newly verified payments may take a few seconds to appear.'));
      let cursor = history.next;
      const more = document.createElement('button'); more.className = 'button secondary'; more.textContent = 'Load more purchases'; more.hidden = !cursor; panel.append(more);
      more.addEventListener('click', async () => {
        more.disabled = true;
        try { const page = await read<{ purchases: Purchase[]; next: string | null }>(`/api/account/purchases?cursor=${encodeURIComponent(cursor || '')}`); if (currentUser?.id !== userId || generation !== accountGeneration) return; appendPurchases(page.purchases); cursor = page.next; more.hidden = !cursor; }
        catch (error) { if (currentUser?.id === userId) status.textContent = error instanceof Error ? error.message : 'History unavailable.'; }
        finally { more.disabled = false; }
      });
      const recent = document.createElement('details'); recent.append(privateText('summary', `Recent logins · ${activity.retentionDays}-day history`));
      for (const event of activity.events) recent.append(privateText('p', `${new Date(event.occurredAt).toLocaleString()} · ${event.ipAddress || 'Unknown IP'} · ${event.userAgent}`));
      panel.append(recent);
    } catch (error) { if (currentUser?.id === userId && generation === accountGeneration) panel.replaceChildren(privateText('p', error instanceof Error ? error.message : 'Account details unavailable.')); }
  }
  accountElement('account-button').addEventListener('click', () => {
    status.textContent = currentUser ? `Signed in as ${currentUser.email} (${currentUser.role}).` : '';
    render(); showLogin(); if (currentUser) void loadAccount();
  });
  const challenge = document.createElement('div'); challenge.id = 'registration-challenge'; form.insertBefore(challenge, accountElement('account-submit'));
  const honeypot = document.createElement('label'); honeypot.className = 'honeypot'; honeypot.textContent = 'Website — leave this field empty';
  const website = document.createElement('input'); website.name = 'website'; website.tabIndex = -1; website.autocomplete = 'off'; honeypot.append(website); form.append(honeypot);
  let challengeId: string | null = null, challengeReady = false, challengeMode = '', challengeGeneration = 0;
  async function prepareChallenge(): Promise<void> {
    const generation = ++challengeGeneration;
    challengeReady = false; challengeMode = ''; challenge.replaceChildren();
    if (challengeId) { window.turnstile?.remove(challengeId); challengeId = null; }
    if (mode.value !== 'register') return;
    try {
      const response = await fetch(appPath('/api/auth/challenge'), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Registration protection is unavailable. Try again later.');
      const config = await response.json();
      if (generation !== challengeGeneration || mode.value !== 'register') return;
      challengeMode = config.provider;
      if (challengeMode === 'disabled') { challengeReady = true; return; }
      if (challengeMode !== 'turnstile' || !config.siteKey) throw new Error('Registration protection is unavailable. Try again later.');
      if (!window.turnstile) await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
        const timer = setTimeout(() => { script.remove(); reject(new Error('Challenge could not load. Switch to login and back to retry.')); }, 8000);
        script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Challenge could not load. Switch to login and back to retry.')); };
        document.head.append(script);
      });
      if (generation !== challengeGeneration || mode.value !== 'register') return;
      if (!window.turnstile) throw new Error('Challenge unavailable. Retry registration.');
      challengeId = window.turnstile.render(challenge, { sitekey: config.siteKey, action: 'register', callback: () => { challengeReady = true; status.textContent = 'Challenge complete.'; }, 'expired-callback': () => { challengeReady = false; status.textContent = 'Challenge expired. Please complete a fresh challenge.'; }, 'error-callback': () => { challengeReady = false; status.textContent = 'Challenge unavailable. Please retry.'; } });
    } catch (error) { if (generation === challengeGeneration) status.textContent = error instanceof Error ? error.message : 'Challenge unavailable.'; }
  }
  mode.addEventListener('change', () => {
    const registering = mode.value === 'register';
    void prepareChallenge();
    accountElement('account-name-label').hidden = !registering;
    accountElement<HTMLInputElement>('account-name').required = registering;
    accountElement<HTMLInputElement>('account-password').autocomplete = registering ? 'new-password' : 'current-password';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = accountElement<HTMLButtonElement>('account-submit'); button.disabled = true; status.textContent = 'Please wait…';
    try {
      if (mode.value === 'register' && !challengeReady) throw new Error('Complete the registration challenge before continuing.');
      const data = { email: accountElement<HTMLInputElement>('account-email').value, password: accountElement<HTMLInputElement>('account-password').value, ...(mode.value === 'register' ? { name: accountElement<HTMLInputElement>('account-name').value, website: website.value, challengeToken: challengeId ? window.turnstile?.getResponse(challengeId) || '' : '' } : {}) };
      currentUser = (await accountRequest(`/api/auth/${mode.value === 'register' ? 'register' : 'login'}`, data)).user;
      accountElement<HTMLInputElement>('account-password').value = ''; render();
      accountElement<HTMLDialogElement>('account-dialog').close();
      await changed();
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Login failed.'; }
    finally { button.disabled = false; if (mode.value === 'register' && challengeMode === 'turnstile') { challengeReady = false; if (challengeId) window.turnstile?.reset(challengeId); } }
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
