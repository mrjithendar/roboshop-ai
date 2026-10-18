import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { body } from '../services/shared/runtime.mjs';
function request(chunks) { const req = Readable.from(chunks); req.headers = { 'content-type': 'application/json' }; return req; }
test('JSON body preserves worldwide addresses split across UTF-8 byte boundaries', async () => {
  const address = { recipient: 'दीपिका', line1: '東京 Straße 🌍' };
  const bytes = Buffer.from(JSON.stringify(address));
  assert.deepEqual(await body(request([...bytes].map(byte => Buffer.from([byte])))), address);
});
test('JSON body limit counts bytes and rejects non-object input', async () => {
  await assert.rejects(body(request([Buffer.from('{"x":"🌍"}')]), 10), { status: 413 });
  await assert.rejects(body(request([Buffer.from('[]')])), { status: 400 });
});
