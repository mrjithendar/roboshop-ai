import { appPath } from './paths.js';
import { initAccount, accountRequest, currentUser } from './account.js';
const accountElement = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = accountElement<HTMLFormElement>('account-form');
const status = accountElement('account-status');
const mode = { value: location.pathname.replace(/\/$/, '').endsWith('/register') ? 'register' : 'login' };
const registering = mode.value === 'register';
let step: 'credentials' | 'mfa' | 'request-reset' | 'reset' = 'credentials';
let loginChallenge = '', resetId = '';
accountElement('forgot-password').hidden = registering;
accountElement<HTMLAnchorElement>('auth-restart').href = appPath('/login');
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
    try {
      const response = await fetch(appPath('/api/auth/challenge'), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Sign-in protection is unavailable. Try again later.');
      const config = await response.json();
      if (generation !== challengeGeneration) return;
      challengeMode = config.provider;
      if (challengeMode === 'disabled') { challengeReady = true; return; }
      if (challengeMode !== 'turnstile' || !config.siteKey) throw new Error('Sign-in protection is unavailable. Try again later.');
      if (!window.turnstile) await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
        const timer = setTimeout(() => { script.remove(); reject(new Error('Challenge could not load. Switch to login and back to retry.')); }, 8000);
        script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Challenge could not load. Switch to login and back to retry.')); };
        document.head.append(script);
      });
      if (generation !== challengeGeneration) return;
      if (!window.turnstile) throw new Error('Challenge unavailable. Retry registration.');
      challengeId = window.turnstile.render(challenge, { sitekey: config.siteKey, action: mode.value, appearance: 'interaction-only', callback: () => { challengeReady = true; }, 'expired-callback': () => { challengeReady = false; status.textContent = 'Challenge expired. Please complete a fresh challenge.'; }, 'error-callback': () => { challengeReady = false; status.textContent = 'Challenge unavailable. Please retry.'; } });
    } catch (error) { if (generation === challengeGeneration) status.textContent = error instanceof Error ? error.message : 'Challenge unavailable.'; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = accountElement<HTMLButtonElement>('account-submit'); button.disabled = true; status.textContent = 'Please wait…';
    try {
      if ((step === 'credentials' || step === 'request-reset') && !challengeReady) throw new Error('Complete the ' + (registering ? 'registration' : 'sign-in') + ' challenge before continuing.');
      const data = { email: accountElement<HTMLInputElement>('account-email').value, password: accountElement<HTMLInputElement>('account-password').value, website: website.value, challengeToken: challengeId ? window.turnstile?.getResponse(challengeId) || '' : '', ...(registering ? { name: accountElement<HTMLInputElement>('account-name').value } : {}) };
      if (step === 'mfa') {
        await accountRequest('/api/auth/mfa/verify', {challengeId: loginChallenge, code: accountElement<HTMLInputElement>('account-code').value.trim()});
        location.assign(destination);
      } else if (step === 'reset') {
        const result = await accountRequest('/api/auth/password/reset', {resetId, code: accountElement<HTMLInputElement>('account-code').value.trim(), password: data.password});
        form.hidden = true; status.textContent = result.message || 'Password updated. Sign in again.';
        accountElement('auth-description').textContent = status.textContent;
      } else if (step === 'request-reset') {
        const result = await accountRequest('/api/auth/password/request', {email:data.email, website:data.website, challengeToken:data.challengeToken});
        resetId = result.resetId || ''; step = 'reset';
        accountElement('auth-description').textContent = result.message || '';
        accountElement('account-password-label').hidden = false;
        accountElement('account-password-label').firstChild!.textContent = 'New password';
        accountElement<HTMLInputElement>('account-code').inputMode = 'numeric';
        accountElement<HTMLInputElement>('account-code').maxLength = 6;
        accountElement<HTMLInputElement>('account-password').required = true;
        accountElement<HTMLInputElement>('account-password').autocomplete = 'new-password';
        accountElement('password-help').hidden = false;
        showCode('Email code', 'Update password');
      } else {
        const result = await accountRequest(`/api/auth/${registering ? 'register' : 'login'}`, data);
        accountElement<HTMLInputElement>('account-password').value = '';
        if (result.mfaRequired) {
          loginChallenge = result.challengeId || ''; step = 'mfa';
          accountElement('auth-title').textContent = 'Verify your sign-in';
          accountElement('auth-description').textContent = 'Enter the six-digit code from Microsoft Authenticator or another authenticator app, or use a backup code.';
          accountElement('account-password-label').hidden = true;
          accountElement<HTMLInputElement>('account-password').required = false;
          accountElement('password-help').hidden = true;
          showCode('Authenticator or backup code', 'Verify and sign in');
        } else location.assign(destination);
      }
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Login failed.'; }
    finally { button.disabled = false; if ((step === 'credentials' || step === 'request-reset') && challengeMode === 'turnstile') { challengeReady = false; if (challengeId) window.turnstile?.reset(challengeId); } }
  });

function showCode(label: string, button: string) {
  accountElement('account-email-label').hidden = true;
  accountElement<HTMLInputElement>('account-email').required = false;
  const codeLabel = accountElement('account-code-label'); codeLabel.hidden = false;
  codeLabel.firstChild!.textContent = label;
  accountElement<HTMLInputElement>('account-code').required = true;
  accountElement<HTMLInputElement>('account-code').focus();
  accountElement('account-submit').textContent = button;
  if (challengeId) { window.turnstile?.remove(challengeId); challengeId = null; }
  challenge.hidden = true; accountElement('forgot-password').hidden = true;
  accountElement('auth-restart').hidden = false; status.textContent = '';
}
accountElement('forgot-password').addEventListener('click', async () => {
  step = 'request-reset';
  accountElement('auth-title').textContent = 'Reset your password';
  accountElement('auth-description').textContent = 'We’ll email a one-use code valid for five minutes.';
  accountElement('account-password-label').hidden = true;
  accountElement<HTMLInputElement>('account-password').required = false;
  accountElement<HTMLInputElement>('account-password').value = '';
  accountElement('password-help').hidden = true;
  accountElement('account-submit').textContent = 'Send reset code';
  accountElement('forgot-password').hidden = true;
  accountElement('auth-restart').hidden = false;
  status.textContent = '';
  await prepareChallenge();
});

await initAccount(async () => {});
if (currentUser) {
  location.replace(destination);
} else {
  accountElement('auth-main').hidden = false;
  await prepareChallenge();
}
