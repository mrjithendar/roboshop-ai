import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { connectMongo } from '../services/catalogue-service/lib/mongo.mjs';
import { Auth } from './fixtures/previous-gateway/auth.mjs';
import { seedProducts } from '../services/catalogue-service/lib/products.mjs';

async function port() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
test('MongoDB accounts, one super admin, server-side roles, persistent sessions and editable catalogue', { timeout: 60000 }, async () => {
  const database = `auth_test_${randomUUID().replaceAll('-', '')}`;
  const { client, db } = await connectMongo(process.env.MONGODB_URL, database);
  const directory = mkdtempSync(join(tmpdir(), 'roboshop-auth-'));
  const gatewayPort = await port(), cataloguePort = await port(), userPort = await port(), base = `http://127.0.0.1:${gatewayPort}`;
  const children = []; let logs = '';
  async function start(name, servicePort) {
    const child = spawn(['ai-gateway', 'user-service'].includes(name) ? (process.env.PYTHON || 'python3') : process.execPath, [`services/${name}/server.${['ai-gateway', 'user-service'].includes(name) ? 'py' : 'mjs'}`], { env: { ...process.env, APP_ENV: 'development', REGISTRATION_CHALLENGE_PROVIDER: 'disabled', CATALOGUE_FILE: fileURLToPath(new URL('./fixtures/catalogue/fictional-products.json', import.meta.url)), MONGODB_DATABASE: database, DATA_DIR: directory, PUBLIC_ORIGIN: base, HOST: '127.0.0.1', PORT: String(servicePort), CATALOGUE_URL: `http://127.0.0.1:${cataloguePort}`, USER_URL: `http://127.0.0.1:${userPort}`, USER_SERVICE_TOKEN: 'test-user-token-0123456789abcdef0123456789', RABBITMQ_URL: '', OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', PAYMENT_SERVICE_TOKEN: 'test-only-token' }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); child.stdout.on('data', chunk => logs += chunk); child.stderr.on('data', chunk => logs += chunk);
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${servicePort}/health`)).ok) return child; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.fail(logs);
  }
  function browser() {
    const cookies = new Map();
    return { cookies, async call(path, method = 'GET', data, headers = {}) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
      for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); if (value) cookies.set(key, value); else cookies.delete(key); }
      return { status: response.status, headers: response.headers, data: await response.json() };
    } };
  }
  const password = 'Test-only-password-2026';
  try {
    const auth = new Auth(db); await auth.initialize();
    const winners = await Promise.allSettled(['one', 'two'].map(name => auth.bootstrap({ email: `${name}@example.com`, password, name })));
    assert.equal(winners.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await db.collection('users').countDocuments({ role: 'superadmin' }), 1);
    const superUser = winners.find(result => result.status === 'fulfilled').value;
    await start('catalogue-service', cataloguePort); let userProcess = await start('user-service', userPort); let gateway = await start('ai-gateway', gatewayPort);
    const customer = browser(), other = browser(), admin = browser();
    assert.equal((await customer.call('/api/admin/products')).status, 401);
    assert.equal((await customer.call('/api/account/profile')).status, 401);
    assert.equal((await customer.call('/api/payments/orders', 'POST', {})).status, 401);
    assert.equal((await customer.call('/api/recommendations/personalized')).status, 401);
    const comparison = await customer.call('/api/compare?skus=RED,RMC');
    assert.equal(comparison.status, 200);
    assert.deepEqual(comparison.data.products.map(p => p.sku), ['RED', 'RMC']);
    assert.equal((await customer.call('/api/compare?skus=RED,RED')).status, 400);
    assert.equal((await customer.call('/api/auth/register', 'POST', { email: 'alice@example.com', name: 'Alice', password, role: 'superadmin' })).status, 400);
    assert.equal((await customer.call('/api/auth/login', 'POST', { email: superUser.email, password }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await customer.call('/api/cart', 'POST', { sku: 'RMC', quantity: 1 })).status, 200);
    const guestCookie = customer.cookies.get('rs_session');
    const registered = await customer.call('/api/auth/register', 'POST', { email: 'Alice@Example.com', name: 'Alice', password });
    assert.equal(registered.status, 201);
    const profile = await customer.call('/api/account/profile');
    assert.equal(profile.data.activity.loginCount, 1);
    assert.equal(profile.data.activity.lastLoginIp, '127.0.0.1');
    assert.ok(profile.data.activity.lastLoginAt);
    assert.equal((await customer.call('/api/account/activity')).data.events.length, 1); assert.equal(registered.data.user.role, 'customer');
    assert.match(registered.headers.get('set-cookie'), /HttpOnly/); assert.match(registered.headers.get('set-cookie'), /SameSite=Strict/);
    assert.ok(!JSON.stringify(registered.data).includes('password'));
    assert.notEqual(customer.cookies.get('rs_session'), guestCookie);
    assert.equal((await customer.call('/api/cart')).data.items[0].quantity, 1);
    const personal = await customer.call('/api/recommendations/personalized');
    assert.equal(personal.status, 200);
    assert.equal(personal.data.basis, 'cart-categories');
    assert.ok(personal.data.products.every(p => p.sku !== 'RMC' && p.instock > 0));
    assert.equal((await customer.call('/api/cart', 'GET', undefined, { cookie: `rs_session=${guestCookie}` })).data.items.length, 0);
    const stored = await db.collection('users').findOne({ email: 'alice@example.com' });
    assert.match(stored.passwordHash, /^scrypt:/); assert.ok(!stored.passwordHash.includes(password));
    assert.equal(await db.collection('auth_sessions').countDocuments({ _id: customer.cookies.get('rs_auth') }), 0, 'raw session tokens are never stored');
    assert.equal((await customer.call('/api/admin/products')).status, 403);
    assert.equal((await other.call('/api/auth/register', 'POST', { email: 'bob@example.com', name: 'Bob', password })).status, 201);
    assert.equal((await other.call('/api/cart')).data.items.length, 0);
    // A stolen cart identifier alone must not confer account ownership.
    assert.equal((await other.call('/api/cart', 'GET', undefined, { cookie: `rs_session=${customer.cookies.get('rs_session')}; rs_auth=${other.cookies.get('rs_auth')}` })).data.items.length, 0);
    assert.equal((await admin.call('/api/auth/login', 'POST', { email: superUser.email, password })).status, 200);
    assert.equal((await admin.call(`/api/admin/users/${superUser.id}`, 'PATCH', { role: 'admin', disabled: false })).status, 409);
    const users = (await admin.call('/api/admin/users')).data.users;
    assert.equal(users.length, 3); assert.ok(!JSON.stringify(users).includes('password'));
    async function mcpCall(token, name, args = {}) {
      const child = spawn(process.env.PYTHON || 'python3', ['services/mcp-server/server.py'], { env: { ...process.env, GATEWAY_URL: base, PUBLIC_ORIGIN: base, MCP_SESSION_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', chunk => output += chunk);
      child.stdin.write([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'auth-test', version: '1' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }].map(JSON.stringify).join('\n') + '\n');
      // Closing stdin cancels in-flight calls, so keep it open until the call is answered.
      const answered = () => output.trim().split('\n').filter(Boolean).map(JSON.parse).find(m => m.id === 2);
      for (let i = 0; i < 200 && !answered(); i++) await new Promise(r => setTimeout(r, 50));
      child.stdin.end(); await once(child, 'exit'); const reply = answered();
      // Admin write tools are not registered unless MCP_ENABLE_ADMIN_WRITES=true: a protocol error, not a result.
      return reply.result ?? { isError: true, protocolError: reply.error };
    }
    assert.equal((await mcpCall(other.cookies.get('rs_auth'), 'admin_list_products')).isError, true);
    assert.equal((await mcpCall(other.cookies.get('rs_auth'), 'update_cart', { sku: 'RED', quantity: 1 })).isError, false);
    assert.equal((await mcpCall(admin.cookies.get('rs_auth'), 'admin_get_settings')).isError, false);
    assert.equal((await mcpCall(admin.cookies.get('rs_auth'), 'admin_set_user_access', { userId: superUser.id, role: 'admin', disabled: false })).isError, true);
    assert.equal((await customer.call(`/api/admin/users/${superUser.id}/profile`)).status, 403);
    assert.equal((await admin.call(`/api/admin/users/${stored._id}/profile`)).data.activity.loginCount, 1);
    const oldCustomerToken = customer.cookies.get('rs_auth');
    assert.equal((await admin.call(`/api/admin/users/${stored._id}`, 'PATCH', { role: 'admin', disabled: false })).status, 200);
    assert.equal((await customer.call('/api/auth/me')).data.user, null);
    assert.equal((await customer.call('/api/admin/products')).status, 401);
    assert.equal((await customer.call('/api/auth/login', 'POST', { email: stored.email, password })).data.user.role, 'admin');
    assert.notEqual(customer.cookies.get('rs_auth'), oldCustomerToken);
    assert.equal((await customer.call('/api/admin/users')).status, 403);
    assert.equal((await customer.call('/api/admin/settings')).status, 403);
    const product = { sku: 'ADMIN-TEST', name: '<script>test</script>', description: 'Created through the admin API', price: 23.45, instock: 3, categories: ['Robot'], archived: false };
    assert.equal((await customer.call('/api/admin/products', 'POST', product)).status, 201);
    assert.equal((await customer.call('/api/admin/products', 'POST', product)).status, 409);
    assert.equal((await customer.call('/api/products')).data.products.find(p => p.sku === product.sku).price, 23.45);
    assert.equal((await customer.call('/api/admin/products/ADMIN-TEST', 'PUT', { ...product, price: 30, revision: 1 })).status, 200);
    assert.equal((await customer.call('/api/admin/products/ADMIN-TEST', 'PUT', { ...product, price: 1, revision: 1 })).status, 409);
    assert.equal((await customer.call('/api/admin/products/ADMIN-TEST', 'PUT', { ...product, archived: true, revision: 2 })).status, 200);
    assert.ok(!(await customer.call('/api/products')).data.products.some(p => p.sku === product.sku));
    const existing = (await customer.call('/api/admin/products')).data.products.find(p => p.sku === 'RMC');
    const update = { sku: existing.sku, name: existing.name, description: existing.description, price: 50, instock: existing.instock, categories: existing.categories, archived: false, revision: existing.revision };
    assert.equal((await customer.call('/api/admin/products/RMC', 'PUT', update)).status, 200);
    await seedProducts(db, fileURLToPath(new URL('./fixtures/catalogue/fictional-products.json', import.meta.url))); assert.equal((await db.collection('products').findOne({ _id: 'RMC' })).price, 50, 'a repeat import does not overwrite edits');
    const settings = { storeName: 'My Robot Shop', announcement: 'Welcome', supportEmail: 'help@example.com', checkoutEnabled: false };
    assert.equal((await admin.call('/api/admin/settings', 'PUT', { ...settings, RAZORPAY_KEY_SECRET: 'must-not-save' })).status, 400);
    assert.equal((await admin.call('/api/admin/settings', 'PUT', settings)).status, 200);
    assert.deepEqual((await other.call('/api/settings')).data, settings);
    assert.equal((await other.call('/api/payments/orders', 'POST', {})).status, 503);
    // Mongo sessions and JSON account-cart ownership survive both service restarts.
    userProcess.kill('SIGTERM'); await once(userProcess, 'exit'); userProcess = await start('user-service', userPort);
    gateway.kill('SIGTERM'); await once(gateway, 'exit'); gateway = await start('ai-gateway', gatewayPort);
    assert.equal((await customer.call('/api/auth/me')).data.user.id, stored._id);
    assert.equal((await customer.call('/api/cart')).data.items[0].quantity, 1);
    const token = other.cookies.get('rs_auth');
    assert.equal((await other.call('/api/auth/logout', 'POST', {})).status, 200);
    assert.equal((await other.call('/api/auth/me', 'GET', undefined, { cookie: `rs_auth=${token}` })).data.user, null);
    assert.equal((await admin.call(`/api/admin/users/${stored._id}`, 'PATCH', { role: 'customer', disabled: true })).status, 200);
    assert.equal((await customer.call('/api/auth/login', 'POST', { email: stored.email, password })).status, 401);
    const expiring = await auth.issue(await auth.users.findOne({ _id: superUser.id }));
    await db.collection('auth_sessions').updateMany({ userId: superUser.id }, { $set: { expiresAt: new Date(0) } });
    assert.equal(await auth.current(expiring), null, 'expired sessions fail even before Mongo TTL cleanup');
    for (let i = 0; i < 20; i++) await auth.limit('test-limiter-only');
    await assert.rejects(auth.limit('test-limiter-only'), { status: 429 });
    assert.ok(!logs.includes(password));
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await db.dropDatabase(); await client.close(); rmSync(directory, { recursive: true, force: true });
  }
});
