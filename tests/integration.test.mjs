import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';

async function freePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
test('full HTTP shopping flow, validation, metrics, traces, MCP and dependency failure', { timeout: 30000 }, async () => {
  const names = ['product-ingestion', 'recommendation-service', 'shopping-agent', 'sre-copilot', 'ai-gateway', 'payment-service'];
  const ports = await Promise.all(names.map(freePort));
  const base = `http://127.0.0.1:${ports[4]}`;
  const dir = mkdtempSync(join(tmpdir(), 'robotshop-integration-'));
  const children = [], traces = []; let logs = '';
  const receiver = createServer(async (req, res) => { let data = ''; for await (const part of req) data += part; traces.push(JSON.parse(data)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
  const env = { ...process.env, HOST: '127.0.0.1', INGESTION_URL: `http://127.0.0.1:${ports[0]}`, RECOMMENDATION_URL: `http://127.0.0.1:${ports[1]}`, AGENT_URL: `http://127.0.0.1:${ports[2]}`, SRE_URL: `http://127.0.0.1:${ports[3]}`, DATA_DIR: dir, PUBLIC_ORIGIN: base, PAYMENT_URL: `http://127.0.0.1:${ports[5]}`, PAYMENT_SERVICE_TOKEN: 'integration-internal-token', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '', OPENAI_API_KEY: '', OPENAI_MODEL: '', LANGFUSE_BASE_URL: '', OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${receiver.address().port}/v1/traces` };
  let cookie;
  async function call(path, options = {}, useCookie = true) {
    const response = await fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(useCookie && cookie ? { cookie } : {}), ...options.headers } });
    if (response.headers.get('set-cookie') && useCookie) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, data: await response.json() };
  }
  try {
    for (let i = 0; i < names.length; i++) {
      const child = spawn(process.execPath, [names[i] === 'payment-service' ? 'tests/fixtures/payment-server.mjs' : `services/${names[i]}/server.mjs`], { env: { ...env, PORT: String(ports[i]) }, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child); child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
    }
    for (const port of ports) {
      let ready = false;
      for (let retry = 0; retry < 100; retry++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 30)); }
      assert.ok(ready, logs);
    }
    assert.match(await (await fetch(base)).text(), /Find your kind of robot/);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/images/STAN-1.png`)).status, 200);
    assert.equal((await call('/api/products')).data.products.length, 11);
    assert.equal((await call('/api/ready')).data.status, 'healthy');
    assert.equal((await call('/api/recommendations?q=security&budget=1000')).data.products[0].sku, 'RED');
    const chat = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'security under 1000' }) });
    assert.equal(chat.data.products[0].sku, 'RED'); assert.equal(chat.data.mode, 'catalogue-search');
    assert.equal((await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 123 }) })).response.status, 400);
    assert.equal((await call('/api/cart')).data.total, 0);
    assert.equal((await call('/api/cart', { method: 'POST', body: JSON.stringify({ sku: 'Ewooid', quantity: 1 }) })).response.status, 409);
    assert.equal((await call('/api/cart', { method: 'POST', body: JSON.stringify({ sku: 'RMC', quantity: -1 }) })).response.status, 400);
    assert.equal((await call('/api/cart', { method: 'POST', body: '{' })).response.status, 400);
    assert.equal((await call('/api/cart', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).response.status, 403);
    const updated = await call('/api/cart', { method: 'POST', body: JSON.stringify({ sku: 'RMC', quantity: 2, price: 0.01 }) });
    assert.equal(updated.data.total, 84);
    assert.equal((await call('/api/cart', {}, false)).data.total, 0);
    assert.equal((await call('/api/orders', { method: 'POST', body: '{}' })).response.status, 410);
    assert.equal((await call('/api/payments/config')).data.enabled, true);
    const orderOptions = { method: 'POST', headers: { 'idempotency-key': 'test-order-00000001' }, body: '{}' };
    const order = await call('/api/payments/orders', orderOptions), retry = await call('/api/payments/orders', orderOptions);
    assert.equal(order.response.status, 201); assert.equal(order.data.order.id, retry.data.order.id); assert.equal(order.data.order.paymentCaptured, false);
    assert.equal(order.data.checkout.amount, 8400);
    assert.equal((await call('/api/payments/status?orderId=' + order.data.order.id, {}, false)).response.status, 404);
    const verification = { orderId: order.data.order.id, razorpay_order_id: 'order_INTEGRATION', razorpay_payment_id: 'pay_INTEGRATION', razorpay_signature: '0'.repeat(64) };
    assert.equal((await call('/api/payments/verify', { method: 'POST', body: JSON.stringify(verification) })).response.status, 400);
    assert.equal((await call('/api/cart')).data.items.length, 1);
    const webhook = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { order_id: 'order_INTEGRATION', id: 'pay_INTEGRATION' } } } });
    const webhookSignature = createHmac('sha256', 'test-webhook-secret').update(webhook).digest('hex');
    assert.equal((await call('/api/payments/webhook', { method: 'POST', headers: { 'x-razorpay-signature': webhookSignature }, body: webhook })).response.status, 200);
    assert.equal((await call('/api/payments/webhook', { method: 'POST', headers: { 'x-razorpay-signature': '0'.repeat(64) }, body: webhook })).response.status, 400);
    assert.equal((await call('/api/payments/status?orderId=' + order.data.order.id)).data.status, 'paid');
    verification.razorpay_signature = createHmac('sha256', 'test-payment-secret').update('order_INTEGRATION|pay_INTEGRATION').digest('hex');
    const verified = await call('/api/payments/verify', { method: 'POST', body: JSON.stringify(verification) });
    assert.equal(verified.data.status, 'paid'); assert.equal(verified.data.paymentCaptured, true);
    assert.equal((await call('/api/payments/verify', { method: 'POST', body: JSON.stringify(verification) })).data.id, order.data.order.id);
    assert.equal((await call('/api/cart')).data.items.length, 0);
    assert.equal((await call('/api/products')).data.products.find(p => p.sku === 'RMC').instock, 46);
    assert.match(await (await fetch(`${base}/metrics`)).text(), /robotshop_http_requests_total/);
    await new Promise(r => setTimeout(r, 100));
    const spans = traces.flatMap(t => t.resourceSpans.flatMap(r => r.scopeSpans.flatMap(s => s.spans)));
    assert.ok(spans.some(s => s.name === 'POST /api/chat' && s.parentSpanId));
    assert.ok(!JSON.stringify(traces).includes('security under 1000'));
    const mcp = spawn(process.execPath, ['services/mcp-server/server.mjs'], { env, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(mcp);
    let output = ''; mcp.stdout.on('data', d => output += d);
    mcp.stdin.end([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_products', arguments: { query: 'mining' } } }, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'execute_shell', arguments: {} } }].map(m => JSON.stringify(m)).join('\n') + '\n');
    await once(mcp, 'exit'); const replies = output.trim().split('\n').map(JSON.parse);
    assert.equal(replies[1].result.tools.length, 2); assert.equal(replies[2].result.isError, false); assert.equal(replies[3].result.isError, true);
    children[0].kill('SIGTERM'); await once(children[0], 'exit');
    assert.equal((await call('/api/ready')).response.status, 503);
    assert.equal((await call('/api/ops')).data.status, 'degraded');
    assert.equal((await call('/api/products')).response.status, 503);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.all(children.map(child => child.exitCode === null ? once(child, 'exit') : Promise.resolve()));
    await new Promise(resolve => receiver.close(resolve)); rmSync(dir, { recursive: true, force: true });
  }
});
