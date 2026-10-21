import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server.mjs';

test('recommendation readiness depends only on catalogue and recovers', async () => {
  let failed = false, status, body;
  const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
  const check = async (url, options) => {
    assert.ok(url.endsWith('/api/catalogue/ready')); assert.ok(options.signal);
    if (failed) throw new Error('catalogue offline');
  };
  for (const down of [false, true, false]) {
    failed = down;
    await handle({ method: 'GET' }, res, new URL('http://recommendations/ready'), check);
    assert.equal(status, down ? 503 : 200);
    assert.equal(body.status, down ? 'unavailable' : 'ready');
  }
});
