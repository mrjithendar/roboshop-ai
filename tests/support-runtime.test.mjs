import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from '../services/payment-service/lib/runtime.mjs';
test('transient GET retries once; writes and authorization failures do not', async () => {
 const original=globalThis.fetch; let count=0;
 try {
  globalThis.fetch=async()=>{count++;return new Response(JSON.stringify({ok:true}),{status:count===1?503:200});};
  assert.deepEqual(await request('http://catalogue/products'),{ok:true});assert.equal(count,2);
  for(const options of [{method:'POST',body:'{}'},{}]) {
   count=0;globalThis.fetch=async()=>{count++;return new Response('{}',{status:options.method?503:401});};
   await assert.rejects(request('http://payment/orders',options));assert.equal(count,1);
  }
 } finally {globalThis.fetch=original;}
});
