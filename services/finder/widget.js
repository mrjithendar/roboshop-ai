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
    section{width:min(380px,calc(100vw - 32px));max-height:calc(100dvh - 110px);overflow:auto;background:white;border:1px solid #ddd;border-radius:20px;box-shadow:0 12px 60px #0003;padding:18px;margin-bottom:12px}header{display:flex;justify-content:space-between;align-items:center}h2{font-size:19px;margin:0}#verification-status{font-size:12px;color:#596962}#error{background:#fff4df;border-radius:10px;padding:10px;font-size:13px}#suggestions{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}#suggestions button{font-size:12px;padding:8px 10px;background:#eef5f2;color:#193d37}.reply{background:#f1f6f4;padding:12px;border-radius:12px}.question{font-weight:600}#send{width:100%}a{border-bottom:1px solid #e1eae5}p{white-space:pre-wrap;line-height:1.5}#messages{max-height:min(48vh,400px);overflow:auto}textarea{font:inherit;width:100%;padding:12px;border:1px solid #999;border-radius:10px;resize:vertical;margin:10px 0}a{display:block;color:#176958;padding:8px 0}small{display:block;color:#555;margin:10px 0}[hidden]{display:none!important}
  </style><section hidden aria-label="Shopping assistant"><header><h2>Finder</h2><button id="close" aria-label="Close assistant">&times;</button></header><div id="messages" role="log" aria-live="polite"><p>Tell me your task, budget and must-have features. I can help shortlist options and explain trade-offs.</p></div><div id="suggestions"><button type="button">Help me choose</button><button type="button">Compare my options</button><button type="button">Find an option under ₹500</button></div><p id="error" role="alert" hidden></p><div id="login-required" hidden><p>Please sign in to use Finder.</p><a id="login-link">Sign in</a></div><form><label for="question">Your question</label><textarea id="question" maxlength="1000" required rows="2"></textarea><button id="send" disabled>Find a match</button></form><small>Check product details before purchasing. Follow-ups use context from this open conversation. Check current prices and availability on product pages.</small></section><button id="open" aria-expanded="false"> Finder</button>`;
  const label = (script.dataset.label || 'Finder').slice(0, 80);
  shadow.querySelector('h2').textContent = label; shadow.querySelector('#open').textContent = label;
  document.body.append(host);
  const get = s => shadow.querySelector(s), panel = get('section'), launcher = get('#open'), input = get('textarea');
  function close() { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
  launcher.onclick = () => { panel.hidden = !panel.hidden; launcher.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) { renderAccess(); if (signedIn) input.focus(); else get('#login-link').focus(); void check(); } };
  get('#close').onclick = close; shadow.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  const call = (path, options = {}) => fetch(new URL(path, base), { mode: 'cors', credentials: base.origin === location.origin ? 'same-origin' : 'omit', ...options, signal: AbortSignal.timeout(path === 'chat' ? 29000 : 2000) });
  let history = [], lastProducts = [];
  let aiConfigured = true, signedIn = false, stopped = false, busy = false;
  const errorBox = get('#error');
  const showError = message => { errorBox.textContent = message; errorBox.hidden = false; };
  const login = new URL('login', shop.href.replace(/\/?$/, '/'));
  if (shop.origin === location.origin) login.searchParams.set('returnTo', location.pathname + location.search + location.hash);
  get('#login-link').href = login.href;
  function renderAccess() {
    get('#login-required').hidden = signedIn;
    get('form').hidden = !signedIn || !aiConfigured;
    get('#suggestions').hidden = !signedIn || !aiConfigured;
    get('#messages').hidden = !signedIn;
    get('#send').disabled = !signedIn || !aiConfigured || busy;
  }
  get('#suggestions').addEventListener('click', e => { if (e.target instanceof HTMLButtonElement) { input.value = e.target.textContent; input.focus(); } });
  async function check() { try { const r = await call('available'); const config = await r.json(); if (!r.ok || !config.available) throw Error(); signedIn = config.authenticated === true; const wasConfigured = aiConfigured; aiConfigured = config.aiConfigured !== false; if (!aiConfigured) showError('Please enable AI. A store administrator needs to configure Ollama or Amazon Bedrock.'); else if (!wasConfigured) errorBox.hidden = true; host.hidden = false; renderAccess(); } catch { if (!panel.hidden) { showError('Finder is temporarily unavailable. Your conversation is still here; try again shortly.'); } else { host.hidden = true; stopped = true; } } }
  // One small cached readiness request per visible minute. Stop polling after failure.
  const timer = setInterval(() => { if (stopped) clearInterval(timer); else if (!document.hidden && !busy) void check(); }, 60000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  get('form').onsubmit = async e => {
    e.preventDefault(); const message = input.value.trim(); if (!message || busy || get('#send').disabled) return; if (!signedIn) { renderAccess(); return; }
    busy = true; errorBox.hidden = true; get('#send').disabled = true; get('#send').textContent = 'Finding matches…';
    const line = document.createElement('p'); line.className = 'question'; line.textContent = 'You: ' + message; get('#messages').append(line); input.value = '';
    const pending = document.createElement('p'); pending.className = 'reply'; pending.textContent = 'Checking the catalogue…'; get('#messages').append(pending);
    try {
      const context = [...history.slice(-2), lastProducts.length ? 'Previously suggested: ' + lastProducts.join(', ') : ''].join('\n').slice(-500);
      const r = await call('chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, context }) });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) { signedIn = false; input.value = message; renderAccess(); return; }
      if ([400, 403, 429].includes(r.status)) { showError(r.status === 429 ? 'Too many requests. Wait a minute, then retry.' : 'Your question could not be accepted. Please try again.'); input.value = message; return; }
      if (data.code === 'ai-not-configured') { aiConfigured = false; input.value = message; showError('Please enable AI. A store administrator needs to configure Ollama or Amazon Bedrock.'); return; }
      if (!r.ok) throw Error();
      const reply = pending; reply.textContent = data.answer || data.notice || 'Please try another question.'; get('#messages').append(reply);
      if (data.mode === 'not-configured') showError('AI is not connected yet. A store administrator needs to configure and activate an LLM provider.');
      else if (data.mode === 'provider-unavailable') showError('The AI provider is unavailable. Please try again shortly.');
      else { history.push(message.slice(0, 180)); history = history.slice(-2); lastProducts = (data.products || []).slice(0, 4).map(p => p.name); }
      for (const product of data.products || []) { const link = document.createElement('a'); link.textContent = product.name; link.href = new URL('products/' + encodeURIComponent(product.slug), shop.href.replace(/\/?$/, '/')).href; get('#messages').append(link); }
      get('#messages').scrollTop = get('#messages').scrollHeight;
    } catch { input.value = message; showError('Your question could not be completed. Please try again shortly. Your conversation has been kept.'); }
    finally { if (pending.textContent === 'Checking the catalogue…') { pending.remove(); line.remove(); } busy = false; get('#send').textContent = 'Find a match'; renderAccess(); if (signedIn) input.focus(); else get('#login-link').focus(); }
  };
  renderAccess();
  void check();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
