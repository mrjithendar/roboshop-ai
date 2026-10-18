const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
let products = [], cart = { items: [], total: 0 }, category = '', chatBusy = false, cartBusy = false, checkoutKey = null;
let toastTimer;
const el = (tag, className, content) => { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(25000) });
  let result;
  try { result = await response.json(); } catch { throw new Error('The service is unavailable. Please try again.'); }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function show(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
function image(p, className = '') { const img = el('img', className); img.src = p.image; img.alt = p.name; img.loading = 'lazy'; img.addEventListener('error', () => { img.src = '/images/placeholder.png'; }, { once: true }); return img; }
function addButton(p) {
  const button = el('button', 'add-button', '+'); button.setAttribute('aria-label', `Add ${p.name} to bag`); button.disabled = p.instock < 1;
  button.addEventListener('click', async () => { button.disabled = true; await add(p); button.disabled = p.instock < 1; }); return button;
}
function card(p) {
  const article = el('article', 'product-card');
  const visual = el('button', 'product-image-button'); visual.setAttribute('aria-label', `View ${p.name}`); visual.append(image(p), el('span', 'product-badge', p.instock > 0 ? p.sku === 'STAN-1' ? 'MEET THE ORIGINAL' : 'READY FOR ADVENTURE' : 'OUT OF STOCK')); visual.addEventListener('click', () => detail(p));
  const title = el('button', 'product-title', p.name); title.addEventListener('click', () => detail(p));
  const bottom = el('div', 'product-bottom'); bottom.append(el('span', 'product-price', money(p.price)), addButton(p));
  article.append(visual, el('p', 'product-category', p.categories.join(' / ')), title, el('p', 'product-description', p.description), bottom);
  return article;
}
function renderProducts() {
  const query = $('#search').value.toLowerCase().trim();
  let visible = products.filter(p => (!category || p.categories.includes(category)) && (!$('#in-stock').checked || p.instock > 0) && `${p.name} ${p.description} ${p.categories.join(' ')}`.toLowerCase().includes(query));
  const sort = $('#sort').value;
  visible.sort(sort === 'price-low' ? (a, b) => a.price - b.price : sort === 'price-high' ? (a, b) => b.price - a.price : sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => Number(b.sku === 'STAN-1') - Number(a.sku === 'STAN-1'));
  $('#products').replaceChildren(...visible.map(card));
  if (!visible.length) $('#products').append(el('p', 'empty-state', 'No robots match just yet. Try another search or category.'));
  $('#result-count').textContent = `${visible.length} extraordinary companion${visible.length === 1 ? '' : 's'}`;
  $('#product-count').textContent = products.length;
}
async function loadProducts() {
  $('#catalogue-error').hidden = true;
  try { products = (await api('/api/products')).products; renderProducts(); }
  catch { $('#products').replaceChildren(); $('#catalogue-error').hidden = false; $('#result-count').textContent = 'Collection unavailable'; }
}
async function loadRecommendations() {
  try { $('#recommendations').replaceChildren(...(await api('/api/recommendations')).products.map(card)); }
  catch { $('#recommendations').replaceChildren(el('p', 'empty-state', 'Recommendations are unavailable right now. Explore the collection above.')); }
}
$('#retry-products').addEventListener('click', loadProducts);
$('#search').addEventListener('input', renderProducts); $('#sort').addEventListener('change', renderProducts); $('#in-stock').addEventListener('change', renderProducts);
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => { category = button.dataset.category; document.querySelectorAll('[data-category]').forEach(tab => { const active = tab === button; tab.classList.toggle('selected', active); tab.setAttribute('aria-pressed', active); }); renderProducts(); }));
function detail(p) {
  const grid = el('div', 'product-detail-grid'), copy = el('div', 'detail-copy');
  const heading = el('h2', '', p.name); heading.id = 'detail-name';
  const buy = el('button', 'button primary', p.instock ? 'Add to bag  +' : 'Out of stock'); buy.disabled = !p.instock;
  buy.addEventListener('click', async () => { buy.disabled = true; await add(p); buy.disabled = !p.instock; });
  copy.append(el('p', 'eyebrow', p.categories.join(' / ')), heading, el('p', '', p.description), el('p', 'product-price', money(p.price)), el('p', '', p.instock ? `${p.instock} available in the demo catalogue` : 'Currently out of stock'), buy);
  grid.append(image(p, 'detail-image'), copy); $('#product-detail').replaceChildren(grid); show('product-dialog');
}
async function add(p) { const quantity = (cart.items.find(item => item.sku === p.sku)?.quantity || 0) + 1; if (await updateCart(p.sku, quantity)) toast(`${p.name} is in your bag.`); }
async function updateCart(sku, quantity) {
  if (cartBusy) return false;
  cartBusy = true;
  try { cart = await api('/api/cart', { method: 'POST', body: JSON.stringify({ sku, quantity }) }); checkoutKey = null; $('#order-result').textContent = ''; renderCart(); return true; }
  catch (error) { toast(error.message); return false; }
  finally { cartBusy = false; }
}
function renderCart() {
  $('#bag-count').textContent = cart.items.reduce((n, item) => n + item.quantity, 0);
  $('#cart-total').textContent = money(cart.total); $('#checkout').disabled = !cart.items.length || !$('#confirm-demo').checked;
  const rows = cart.items.map(p => {
    const row = el('div', 'cart-row'), info = el('div'), qty = el('div', 'quantity-control');
    for (const [symbol, quantity, label] of [['−', p.quantity - 1, 'Decrease'], ['+', p.quantity + 1, 'Increase']]) {
      const button = el('button', '', symbol); button.setAttribute('aria-label', `${label} ${p.name} quantity`); button.addEventListener('click', () => updateCart(p.sku, quantity));
      if (symbol === '+') { qty.append(el('span', '', String(p.quantity))); button.disabled = p.quantity >= Math.min(p.instock, 20); } qty.append(button);
    }
    const remove = el('button', 'remove-button', 'Remove'); remove.addEventListener('click', () => updateCart(p.sku, 0));
    info.append(el('h3', '', p.name), el('p', '', money(p.lineTotal)), qty); row.append(image(p), info, remove); return row;
  });
  $('#cart-items').replaceChildren(...(rows.length ? rows : [el('p', 'empty-state', 'Your next companion is waiting. Explore the collection to fill your bag.')]));
}
$('#bag-button').addEventListener('click', async () => { show('cart-dialog'); try { cart = await api('/api/cart'); renderCart(); } catch (error) { toast(error.message); } });
$('#confirm-demo').addEventListener('change', renderCart);
$('#checkout').addEventListener('click', async () => {
  if (cartBusy || !$('#confirm-demo').checked) return;
  cartBusy = true; $('#checkout').disabled = true; checkoutKey ||= crypto.randomUUID();
  try {
    const order = await api('/api/orders', { method: 'POST', headers: { 'idempotency-key': checkoutKey }, body: JSON.stringify({ confirmDemo: true }) });
    cart = { items: [], total: 0 }; $('#confirm-demo').checked = false; renderCart();
    $('#order-result').textContent = `Demo order ${order.id.slice(0, 8)} confirmed. ${money(order.total)} total. No payment was taken.`;
    checkoutKey = null; await Promise.all([loadProducts(), loadRecommendations()]);
  } catch (error) { $('#order-result').textContent = error.message; $('#checkout').disabled = false; }
  finally { cartBusy = false; }
});
for (const id of ['ask-nav', 'hero-assistant', 'banner-assistant', 'assistant-launcher']) $(`#${id}`).addEventListener('click', () => { show('assistant-dialog'); $('#message').focus(); });
function chatMessage(role, content) { const node = el('div', `chat-message ${role}`); node.append(el('span', 'message-label', role === 'user' ? 'YOU' : 'ROBOTSHOP ASSISTANT'), el('p', '', content)); $('#chat-messages').append(node); node.scrollIntoView({ block: 'nearest' }); return node; }
async function chat(message) {
  if (chatBusy || !message.trim()) return;
  chatBusy = true; $('#send-message').disabled = true; $('#message').value = ''; chatMessage('user', message);
  const pending = chatMessage('assistant', 'Finding your match…');
  try {
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });
    pending.querySelector('p').textContent = result.answer; $('#assistant-mode').textContent = result.notice;
    for (const p of result.products) { const row = el('div', 'chat-product'), info = el('div'); info.append(el('strong', '', p.name), el('span', '', money(p.price))); row.append(image(p), info, addButton(p)); pending.append(row); }
  } catch (error) { pending.querySelector('p').textContent = error.message; }
  finally { chatBusy = false; $('#send-message').disabled = false; $('#message').focus(); pending.scrollIntoView({ block: 'nearest' }); }
}
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); chat($('#message').value); });
$('#message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); chat($('#message').value); } });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => chat(button.dataset.prompt)));
async function loadOps() {
  $('#ops-content').replaceChildren(el('p', '', 'Checking services…'));
  try {
    const result = await api('/api/ops');
    const nodes = [el('p', '', result.summary)];
    for (const service of result.services) { const row = el('div', 'health-row'); row.append(el('span', '', service.name), el('span', service.status === 'healthy' ? 'healthy' : 'unavailable', `${service.status} · ${service.latencyMs} ms`)); nodes.push(row); }
    const steps = el('ul'); for (const step of result.nextSteps) steps.append(el('li', '', step)); nodes.push(steps, el('p', '', `Checked ${new Date(result.checkedAt).toLocaleTimeString()}. No infrastructure actions executed.`)); $('#ops-content').replaceChildren(...nodes);
  } catch (error) { $('#ops-content').replaceChildren(el('p', '', error.message)); }
}
$('#ops-button').addEventListener('click', () => { show('ops-dialog'); loadOps(); }); $('#refresh-ops').addEventListener('click', loadOps);
await Promise.all([loadProducts(), loadRecommendations(), api('/api/cart').then(result => { cart = result; renderCart(); }).catch(() => toast('Your bag could not be loaded. Please try again.')), api('/api/status').then(result => { $('#assistant-mode').textContent = result.assistantMode === 'ai' ? 'AI assistant connected · grounded in the catalogue' : 'Catalogue search mode · no language model connected'; }).catch(() => {})]);
