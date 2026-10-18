import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { connectMongo } from '../services/shared/mongo.mjs';
import { createHmac } from 'node:crypto';
import amqp from 'amqplib';
import { startNginx } from './helpers/nginx.mjs';

async function freePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
test('full HTTP shopping flow, validation, metrics, traces, MCP and dependency failure', { timeout: 60000 }, async () => {
  const mongoDatabase = `integration_${randomUUID().replaceAll('-', '')}`;
  const mongo = await connectMongo(process.env.MONGODB_URL, mongoDatabase);
  const names = ['product-ingestion', 'recommendation-service', 'shopping-agent', 'sre-copilot', 'ai-gateway', 'payment-service', 'shipping-service'];
  const ports = await Promise.all(names.map(freePort));
  const edgePort = process.env.NGINX_TEST === 'true' ? await freePort() : null;
  const base = `http://127.0.0.1:${edgePort || ports[4]}`;
  let edge;
  const dir = mkdtempSync(join(tmpdir(), 'robotshop-integration-'));
  const children = [], traces = [], binaryTraces = []; let logs = '';
  const receiver = createServer(async (req, res) => { const chunks = []; for await (const part of req) chunks.push(part); const data = Buffer.concat(chunks); if (req.headers['content-type']?.includes('json')) { traces.push(JSON.parse(data)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); } else { binaryTraces.push(data); res.writeHead(200, { 'content-type': 'application/x-protobuf' }); res.end(); } });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
  const env = { ...process.env, SHIPPING_TRACING_ENABLED: 'true', OTEL_BSP_SCHEDULE_DELAY: '500', MONGODB_DATABASE: mongoDatabase, HOST: '127.0.0.1', TRUST_PROXY: edgePort ? 'true' : 'false', INGESTION_URL: `http://127.0.0.1:${ports[0]}`, RECOMMENDATION_URL: `http://127.0.0.1:${ports[1]}`, AGENT_URL: `http://127.0.0.1:${ports[2]}`, SRE_URL: `http://127.0.0.1:${ports[3]}`, DATA_DIR: dir, PUBLIC_ORIGIN: base, GATEWAY_URL: base, PAYMENT_URL: `http://127.0.0.1:${ports[5]}`, SHIPPING_URL: `http://127.0.0.1:${ports[6]}`, LLM_SERVICE_TOKEN: 'integration-only-token-0123456789abcdef', PAYMENT_SERVICE_TOKEN: 'integration-internal-token', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '', OPENAI_API_KEY: '', OPENAI_MODEL: '', LANGFUSE_BASE_URL: '', OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${receiver.address().port}/v1/traces` };
  let cookie; const cookieJar = new Map();
  async function call(path, options = {}, useCookie = true) {
    const response = await fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', origin: base, ...(useCookie && cookie ? { cookie } : {}), ...options.headers } });
    if (useCookie) { for (const value of response.headers.getSetCookie()) { const [key, val] = value.split(';')[0].split('='); if (val) cookieJar.set(key, val); else cookieJar.delete(key); } cookie = [...cookieJar].map(([key, value]) => `${key}=${value}`).join('; '); }
    return { response, data: await response.json() };
  }
  try {
    for (let i = 0; i < names.length; i++) {
      const child = spawn(names[i] === 'shipping-service' ? 'java' : ['ai-gateway', 'shopping-agent'].includes(names[i]) ? (process.env.PYTHON || 'python3') : process.execPath, names[i] === 'shipping-service' ? ['-jar', 'services/shipping-service/build/libs/shipping-service.jar'] : [names[i] === 'payment-service' ? 'tests/fixtures/payment-server.mjs' : `services/${names[i]}/server.${['ai-gateway', 'shopping-agent'].includes(names[i]) ? 'py' : 'mjs'}`], { env: { ...env, PORT: String(ports[i]) }, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child); child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
    }
    for (const port of ports) {
      let ready = false;
      for (let retry = 0; retry < 600; retry++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 30)); }
      assert.ok(ready, logs);
    }
    if (edgePort) edge = await startNginx({ port: edgePort, gatewayPort: ports[4], directory: dir });
    assert.match(await (await fetch(base)).text(), /Find your kind of robot/);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/images/STAN-1.png`)).status, 200);
    assert.equal((await call('/api/products')).data.products.length, 11);
    assert.equal((await call('/api/ready')).data.status, 'healthy');
    assert.equal((await call('/api/recommendations?q=security&budget=1000')).data.products[0].sku, 'RED');
    const chat = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'security under 1000' }) });
    const privateResponse = await fetch(`http://127.0.0.1:${ports[2]}/internal/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_SERVICE_TOKEN}` }, body: JSON.stringify({ config: { provider: 'none' }, revision: 0 }) });
    assert.equal(privateResponse.status, 200); assert.equal((await privateResponse.json()).mode, 'not-configured');
    assert.deepEqual(chat.data.products, []); assert.equal(chat.data.mode, 'not-configured'); assert.equal(chat.data.answer, 'Please connect an LLM to get AI recommendations.');
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
    assert.equal((await call('/api/payments/orders', { method: 'POST', body: '{}' })).response.status, 401);
    assert.equal((await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Buyer', email: 'buyer@example.com', password: 'Test-only-checkout-2026' }) })).response.status, 201);
    const orderOptions = { method: 'POST', headers: { 'idempotency-key': 'test-order-00000001' }, body: '{}' };
    assert.equal((await call('/api/payments/orders', orderOptions)).response.status, 400);
    const countries = (await call('/api/shipping/countries')).data.countries;
    assert.equal(countries.length, 252);
    assert.equal(countries.reduce((n,c)=>n+c.cityCount,0),34167);
    assert.equal((await call('/api/shipping/cities?country=XX&q=City')).response.status,400);
    assert.deepEqual((await call('/api/shipping/cities?country=IN&q=' + encodeURIComponent("'; DROP TABLE shipping.cities;--"))).data.cities,[]);
    const cities = (await call('/api/shipping/cities?country=IN&q=Hyderabad')).data.cities;
    assert.ok(cities.length);
    const destination = { cityId: cities[0].id, recipient: 'Integration Customer', line1: '123 Test Street', postalCode: '500001', cost: 0 };
    assert.equal((await call('/api/shipping/quote', { method: 'POST', body: JSON.stringify({ ...destination, cityId: -1 }) })).response.status, 400);
    const quote = await call('/api/shipping/quote', { method: 'POST', body: JSON.stringify(destination) });
    assert.equal((await call('/api/shipping/quote', { method: 'POST', body: JSON.stringify({...destination,recipient:''}) })).response.status,400);
    assert.equal((await call('/api/shipping/quote', { method: 'POST', body: JSON.stringify({...destination,line1:'bad\naddress'}) })).response.status,400);
    assert.equal(quote.response.status, 200); assert.ok(quote.data.shipping.cost > 0);
    assert.equal(quote.data.total, (8400 + Math.round(quote.data.shipping.cost * 100)) / 100);
    const order = await call('/api/payments/orders', orderOptions), retry = await call('/api/payments/orders', orderOptions);
    assert.equal(order.response.status, 201); assert.equal(order.data.order.id, retry.data.order.id); assert.equal(order.data.order.paymentCaptured, false);
    assert.equal(order.data.checkout.amount, Math.round(quote.data.total * 100));
    assert.equal((await call('/api/shipping/quote', { method: 'POST', body: JSON.stringify(destination) })).response.status, 409);
    assert.equal((await call('/api/payments/status?orderId=' + order.data.order.id, {}, false)).response.status, 401);
    const verification = { orderId: order.data.order.id, razorpay_order_id: 'order_INTEGRATION', razorpay_payment_id: 'pay_INTEGRATION', razorpay_signature: '0'.repeat(64) };
    assert.equal((await call('/api/payments/verify', { method: 'POST', body: JSON.stringify(verification) })).response.status, 400);
    assert.equal((await call('/api/cart')).data.items.length, 1);
    const webhook = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { order_id: 'order_INTEGRATION', id: 'pay_INTEGRATION' } } } });
    const webhookSignature = createHmac('sha256', 'test-webhook-secret').update(webhook).digest('hex');
    const capturedWebhook = await call('/api/payments/webhook', { method: 'POST', headers: { 'x-razorpay-signature': webhookSignature }, body: webhook });
    assert.equal(capturedWebhook.response.status, 200);
    const paidTrace = capturedWebhook.response.headers.get('x-request-id');
    assert.equal((await call('/api/payments/webhook', { method: 'POST', headers: { 'x-razorpay-signature': '0'.repeat(64) }, body: webhook })).response.status, 400);
    assert.equal((await call('/api/payments/status?orderId=' + order.data.order.id)).data.status, 'paid');
    verification.razorpay_signature = createHmac('sha256', 'test-payment-secret').update('order_INTEGRATION|pay_INTEGRATION').digest('hex');
    const verified = await call('/api/payments/verify', { method: 'POST', body: JSON.stringify(verification) });
    assert.equal(verified.data.status, 'paid'); assert.equal(verified.data.paymentCaptured, true);
    assert.equal((await call('/api/payments/verify', { method: 'POST', body: JSON.stringify(verification) })).data.id, order.data.order.id);
    assert.equal((await call('/api/cart')).data.items.length, 0);
    let history;
    for (let retry = 0; retry < 100; retry++) { history = (await call('/api/account/purchases')).data; if (history.purchases?.length) break; await new Promise(r => setTimeout(r, 50)); }
    assert.equal(history.purchases.length, 1);
    assert.equal(history.purchases[0].id, order.data.order.id);
    assert.equal(history.purchases[0].shipping.address.line1, destination.line1);
    assert.ok(!JSON.stringify(history).includes('razorpay'));
    assert.equal((await call('/api/account/profile')).data.addresses.length, 1);

    if (env.RABBITMQ_URL) {
      let published=false;
      for(let retry=0;retry<100;retry++) {
        published=Boolean(JSON.parse(readFileSync(join(dir,'store.json'),'utf8')).orders.find(o=>o.id===order.data.order.id)?.shipmentEvent?.publishedAt);
        if(published) break;
        await new Promise(r=>setTimeout(r,100));
      }
      assert.ok(published,'Paid-order event must receive a RabbitMQ publisher confirmation');
      let consumed=false;
      for(let retry=0;retry<100;retry++) {
        const metrics=await (await fetch(`http://127.0.0.1:${ports[6]}/metrics`)).text();
        consumed=/robotshop_shipping_events_total\{[^}]*result="accepted"[^}]*\} [1-9]/.test(metrics);
        if(consumed) break;
        await new Promise(r=>setTimeout(r,100));
      }
      assert.ok(consumed,'Java shipping consumer must persist a shipment request');
      const broker=await amqp.connect(env.RABBITMQ_URL), channel=await broker.createConfirmChannel();
      try {
        const saved=JSON.parse(readFileSync(join(dir,'store.json'),'utf8')).orders.find(o=>o.id===order.data.order.id);
        const event={...saved.shipmentEvent,type:'order.paid',version:1,orderId:saved.id,shipping:saved.shipping,items:saved.items.map(({sku,quantity})=>({sku,quantity}))};
        const publish = data => new Promise((resolve,reject)=>channel.publish('robotshop.orders','order.paid',Buffer.from(JSON.stringify(data)),{persistent:true,contentType:'application/json'},error=>error?reject(error):resolve()));
        await publish(event);
        let duplicate=false;
        for(let retry=0;retry<100;retry++) {
          const metrics=await (await fetch(`http://127.0.0.1:${ports[6]}/metrics`)).text();
          duplicate=/robotshop_shipping_events_total\{[^}]*result="duplicate"[^}]*\} [1-9]/.test(metrics);
          if(duplicate) break;
          await new Promise(r=>setTimeout(r,100));
        }
        assert.ok(duplicate,'Redelivered paid events must not create duplicate shipments');
        const before=(await channel.checkQueue('robotshop.shipping.failed')).messageCount;
        await publish({type:'invalid',test:true});
        let deadLettered=false;
        for(let retry=0;retry<250;retry++) {
          deadLettered=(await channel.checkQueue('robotshop.shipping.failed')).messageCount>before;
          if(deadLettered) break;
          await new Promise(r=>setTimeout(r,100));
        }
        assert.ok(deadLettered,'Invalid events must route to the dead-letter queue');
      } finally { await channel.close(); await broker.close(); }
    }
    if(env.CACHE_ENABLED==='true') {
      await call('/api/shipping/countries'); await call('/api/shipping/countries');
      const metrics=await (await fetch(`http://127.0.0.1:${ports[6]}/metrics`)).text();
      assert.match(metrics,/robotshop_location_cache_total\{[^}]*result="hit"/);
    }

    assert.equal((await call('/api/products')).data.products.find(p => p.sku === 'RMC').instock, 46);
    assert.match(await (await fetch(`http://127.0.0.1:${ports[4]}/metrics`)).text(), /robotshop_http_requests_total/);
    await new Promise(r => setTimeout(r, 100));
    const spans = traces.flatMap(t => t.resourceSpans.flatMap(r => r.scopeSpans.flatMap(s => s.spans)));
    assert.ok(spans.some(s => s.name === 'POST /api/chat')); // no agent call when unconfigured
    assert.ok(!JSON.stringify(traces).includes('security under 1000'));
    const mcp = spawn(process.env.PYTHON || 'python3', ['services/mcp-server/server.py'], { env, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(mcp);
    let output = ''; mcp.stdout.on('data', d => output += d);
    mcp.stdin.end([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_products', arguments: { query: 'mining' } } }, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'execute_shell', arguments: {} } }].map(m => JSON.stringify(m)).join('\n') + '\n');
    await once(mcp, 'exit'); const replies = output.trim().split('\n').map(JSON.parse);
    assert.equal(replies[1].result.tools.length, 15); assert.equal(replies[2].result.isError, false); assert.equal(replies[3].error.code, -32602);
    const serviceNames = new Set(traces.flatMap(t => t.resourceSpans.map(r => r.resource.attributes.find(a => a.key === 'service.name')?.value.stringValue)));
    for (const service of ['ai-gateway', 'shopping-agent', 'product-ingestion', 'recommendation-service', 'sre-copilot', 'payment-service', 'mcp-server']) assert.ok(serviceNames.has(service), `Missing spans for ${service}`);
    assert.ok(traces.some(t => t.resourceSpans.some(r => r.scopeSpans.some(s => s.spans.some(span => span.kind === 3 && span.parentSpanId)))), 'outbound client spans');
    for (let retry = 0; retry < 160 && !binaryTraces.some(b => b.includes(Buffer.from('shipping-service'))); retry++) await new Promise(r => setTimeout(r, 50));
    assert.ok(binaryTraces.some(b => b.includes(Buffer.from('shipping-service'))), 'Java shipping must export OTLP spans');
    if (env.RABBITMQ_URL) {
      assert.ok(binaryTraces.some(b => b.includes(Buffer.from(paidTrace, 'hex')) && b.includes(Buffer.from('robotshop.shipping.orders'))), 'Rabbit consumer must continue the payment trace');
      assert.ok(traces.some(t => t.resourceSpans.some(r => r.scopeSpans.some(s => s.spans.some(span => span.kind === 4 && span.traceId === paidTrace)))), 'Rabbit producer span must continue the payment trace');
    }
    const telemetry = JSON.stringify(traces) + binaryTraces.map(b => b.toString()).join('');
    for (const secret of [destination.line1, destination.recipient, 'security under 1000', 'integration@example.com', 'rs_auth=']) assert.ok(!telemetry.includes(secret), `Private data appeared in telemetry: ${secret}`);
    children[0].kill('SIGTERM'); await once(children[0], 'exit');
    assert.equal((await call('/api/ready')).response.status, 503);
    assert.equal((await call('/api/ops')).data.status, 'degraded');
    assert.equal((await call('/api/products')).response.status, 503);
  } finally {
    if (edge) await edge.stop();
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.all(children.map(child => child.exitCode === null ? once(child, 'exit') : Promise.resolve()));
    await new Promise(resolve => receiver.close(resolve)); await mongo.db.dropDatabase(); await mongo.client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
