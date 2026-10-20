import { appPath } from './paths.js';
import { initAccount, accountRequest } from './account.js';
const accountElement = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = accountElement<HTMLFormElement>('account-form');
const status = accountElement('account-status');
const mode = { value: location.pathname.replace(/\/$/, '').endsWith('/register') ? 'register' : 'login' };
const registering = mode.value === 'register';
// Only return to known storefront routes on this origin; never trust arbitrary URLs.
const candidate = new URLSearchParams(location.search).get('returnTo') || appPath('/account');
let destination = appPath('/account');
try {
  const url = new URL(candidate, location.origin);
  const allowed = [appPath('/'), appPath('/cart'), appPath('/checkout'), appPath('/account'), appPath('/admin')];
  const products = appPath('/products/');
  if (url.origin === location.origin && (allowed.includes(url.pathname) || (url.pathname.startsWith(products) && /^[a-z0-9][a-z0-9-]{0,99}$/.test(url.pathname.slice(products.length))))) destination = url.pathname + url.search + url.hash;
} catch { /* Use the account page for invalid return addresses. */ }
document.title = registering ? 'Create account · RobotShop' : 'Sign in · RobotShop';
accountElement('auth-title').textContent = registering ? 'Create your account' : 'Welcome back';
accountElement('auth-description').textContent = registering ? 'One account for your orders, profile and delivery addresses.' : 'Sign in to manage your orders and pick up where you left off.';
accountElement('account-submit').textContent = registering ? 'Create account' : 'Sign in';
accountElement('account-name-label').hidden = !registering;
accountElement<HTMLInputElement>('account-name').required = registering;
accountElement<HTMLInputElement>('account-password').autocomplete = registering ? 'new-password' : 'current-password';
accountElement('auth-switch-copy').textContent = registering ? 'Already have an account?' : 'New to RobotShop?';
const switchLink = accountElement<HTMLAnchorElement>('auth-switch');
switchLink.textContent = registering ? 'Sign in' : 'Create an account';
switchLink.href = appPath(registering ? '/login' : '/register') + '?returnTo=' + encodeURIComponent(destination);
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
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = accountElement<HTMLButtonElement>('account-submit'); button.disabled = true; status.textContent = 'Please wait…';
    try {
      if (mode.value === 'register' && !challengeReady) throw new Error('Complete the registration challenge before continuing.');
      const data = { email: accountElement<HTMLInputElement>('account-email').value, password: accountElement<HTMLInputElement>('account-password').value, ...(mode.value === 'register' ? { name: accountElement<HTMLInputElement>('account-name').value, website: website.value, challengeToken: challengeId ? window.turnstile?.getResponse(challengeId) || '' : '' } : {}) };
      await accountRequest(`/api/auth/${mode.value === 'register' ? 'register' : 'login'}`, data);
      accountElement<HTMLInputElement>('account-password').value = '';
      location.assign(destination);
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Login failed.'; }
    finally { button.disabled = false; if (mode.value === 'register' && challengeMode === 'turnstile') { challengeReady = false; if (challengeId) window.turnstile?.reset(challengeId); } }
  });

await initAccount(async () => {});
if (registering) await prepareChallenge();
