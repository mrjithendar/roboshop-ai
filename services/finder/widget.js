(() => {
  const script = document.currentScript;
  if (!script) return;
  function mount() {
  if (document.getElementById('finder-widget')) return;
  const base = new URL('.', script.src);
  const shop = new URL(script.dataset.store || '../', base);
  if (!['https:', 'http:'].includes(shop.protocol)) return;
  const host = document.createElement('div'); host.id = 'finder-widget'; host.hidden = true;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{all:initial;font:15px system-ui;color:#172026;position:fixed;bottom:20px;right:20px;z-index:10000} :host([hidden]){display:none}
    *{box-sizing:border-box}button{cursor:pointer;font:inherit;border:0;border-radius:24px;padding:12px 18px;background:#193d37;color:white}button:disabled{opacity:.6}
    section{width:min(380px,calc(100vw - 32px));max-height:calc(100dvh - 110px);overflow:auto;background:white;border:1px solid #ddd;border-radius:20px;box-shadow:0 12px 60px #0003;padding:18px;margin-bottom:12px}header{display:flex;justify-content:space-between;align-items:center}h2{font-size:19px;margin:0}p{white-space:pre-wrap;line-height:1.5}#messages{max-height:min(48vh,400px);overflow:auto}textarea{font:inherit;width:100%;padding:12px;border:1px solid #999;border-radius:10px;resize:vertical;margin:10px 0}a{display:block;color:#176958;padding:8px 0}small{display:block;color:#555;margin:10px 0}[hidden]{display:none!important}
  </style><section hidden aria-label="Shopping assistant"><header><h2>Finder</h2><button id="close" aria-label="Close assistant">&times;</button></header><div id="messages" role="log" aria-live="polite"><p>Tell me what you are looking for.</p></div><form><label for="question">Your question</label><textarea id="question" maxlength="1000" required rows="2"></textarea><div id="challenge"></div><p id="verification-status" role="status">Complete human verification to ask a question.</p><button id="send" disabled>Find a match</button></form><small>Check product details before purchasing. Each question searches independently.</small></section><button id="open" aria-expanded="false"> Finder</button>`;
  const label = (script.dataset.label || 'Finder').slice(0, 80);
  shadow.querySelector('h2').textContent = label; shadow.querySelector('#open').textContent = label;
  document.body.append(host);
  const get = s => shadow.querySelector(s), panel = get('section'), launcher = get('#open'), input = get('textarea');
  function close() { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
  launcher.onclick = () => { panel.hidden = !panel.hidden; launcher.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) { input.focus(); void prepareChallenge(); } };
  get('#close').onclick = close; shadow.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  const call = (path, options = {}) => fetch(new URL(path, base), { mode: 'cors', credentials: 'omit', ...options, signal: AbortSignal.timeout(path === 'chat' ? 29000 : 2000) });
  let stopped = false, siteKey = '', challengeId = null, token = '', loadingChallenge = false, busy = false;
  const status = get('#verification-status');
  function resetChallenge() { token = ''; get('#send').disabled = true; if (challengeId !== null) window.turnstile?.reset(challengeId); }
  async function prepareChallenge() {
    if (challengeId !== null || loadingChallenge || !siteKey) return;
    loadingChallenge = true;
    try {
      if (!window.turnstile) await new Promise((resolve, reject) => {
        const sdk = document.createElement('script'); sdk.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sdk.async = true;
        const timeout = setTimeout(() => reject(Error('timeout')), 10000);
        sdk.onload = () => { clearTimeout(timeout); resolve(); }; sdk.onerror = () => { clearTimeout(timeout); sdk.remove(); reject(Error('load')); }; document.head.append(sdk);
      });
      if (!window.turnstile) throw Error();
      challengeId = window.turnstile.render(get('#challenge'), { sitekey: siteKey, action: 'finder', size: 'compact',
        callback: value => { token = value; get('#send').disabled = busy || !token; status.textContent = 'Verified. You can ask your question.'; },
        'expired-callback': () => { token = ''; get('#send').disabled = true; status.textContent = 'Verification expired. Please verify again.'; },
        'error-callback': () => { token = ''; get('#send').disabled = true; status.textContent = 'Verification failed. Close and reopen Finder to retry.'; window.turnstile?.remove(challengeId); challengeId = null; }
      });
    } catch { status.textContent = 'Verification could not load. Close and reopen Finder to retry.'; }
    finally { loadingChallenge = false; }
  }
  async function check() { try { const r = await call('available'); const config = await r.json(); if (!r.ok || !config.available || !config.siteKey) throw Error(); siteKey = config.siteKey; host.hidden = false; } catch { host.hidden = true; panel.hidden = true; stopped = true; } }
  // One small cached readiness request per visible minute. Stop polling after failure.
  const timer = setInterval(() => { if (stopped) clearInterval(timer); else if (!document.hidden) void check(); }, 60000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  get('form').onsubmit = async e => {
    e.preventDefault(); const message = input.value.trim(); if (!message || !token || busy || get('#send').disabled) return;
    busy = true; get('#send').disabled = true;
    const line = document.createElement('p'); line.textContent = 'You: ' + message; get('#messages').append(line); input.value = '';
    try {
      const r = await call('chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, challengeToken: token }) }); if ([400, 403, 429].includes(r.status)) { status.textContent = r.status === 429 ? 'Too many requests. Wait a minute, then verify again.' : 'Please complete a fresh verification.'; input.value = message; return; } if (!r.ok) throw Error();
      const data = await r.json(), reply = document.createElement('p'); reply.textContent = data.answer || data.notice || 'Please try another question.'; get('#messages').append(reply);
      for (const product of data.products || []) { const link = document.createElement('a'); link.textContent = product.name; link.href = new URL('products/' + encodeURIComponent(product.slug), shop.href.replace(/\/?$/, '/')).href; get('#messages').append(link); }
      get('#messages').scrollTop = get('#messages').scrollHeight;
    } catch { host.hidden = true; stopped = true; }
    finally { busy = false; resetChallenge(); }
  };
  void check();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
