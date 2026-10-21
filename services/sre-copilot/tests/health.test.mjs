import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnostics, handle } from '../server.mjs';

test('aggregate optional failures degrade diagnostics but not SRE readiness', async () => {
  let failed = true;
  const targets = { catalogue: 'http://catalogue', agent: 'http://agent', finder: 'http://finder', sre: 'http://sre' };
  const seen = [];
  const check = async (url, options) => {
    assert.ok(options.signal); seen.push(url);
    if (failed && !url.startsWith('http://catalogue')) throw new Error('optional offline');
  };
  const result = await diagnostics(check, targets);
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.services.filter(s => s.status === 'unavailable').map(s => s.name), ['agent', 'finder']);
  assert.equal(seen.some(url => url.includes('/api/ops') || url.includes('http://sre')), false);
  let code, body;
  handle({ method: 'GET' }, { writeHead(status) { code = status; }, end(value) { body = JSON.parse(value); } }, new URL('http://sre/ready'));
  assert.equal(code, 200); assert.equal(body.status, 'ready');
  failed = false;
  assert.equal((await diagnostics(check, targets)).status, 'healthy');
});

test('diagnostics applies a bounded timeout to every dependency', async () => {
  const check = (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  // Keep the event loop alive while AbortSignal's unref'ed deadline expires.
  const keepAlive = setInterval(() => {}, 100);
  try {
    const start = Date.now();
    assert.equal((await diagnostics(check, { agent: 'http://agent', finder: 'http://finder' })).status, 'degraded');
    assert.ok(Date.now() - start < 3000, 'probes should run concurrently');
  } finally { clearInterval(keepAlive); }
});
