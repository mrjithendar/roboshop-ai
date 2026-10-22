import test from 'node:test';
import assert from 'node:assert/strict';
import { context, logEvent, clientSpan } from '../services/payment-service/lib/runtime.mjs';

test('operational logs retain trace and timing but exclude arbitrary sensitive fields', async () => {
  const rows=[]; const original=console.log;
  console.log=line=>rows.push(JSON.parse(line));
  try {
    await context.run({service:'payment-service',traceId:'a'.repeat(32)},async()=>{
      logEvent('checkout_started',{status:200,password:'secret',body:'private'});
      await assert.rejects(clientSpan('HTTP Razorpay',async()=>{ throw new Error('private secret'); }));
    });
  } finally { console.log=original; }
  assert.equal(rows[0].traceId,'a'.repeat(32));
  assert.equal(rows[1].event,'dependency_call_completed');
  assert.equal(rows[1].status,503);
  assert.doesNotMatch(JSON.stringify(rows),/private|secret/);
});

test('provider HTTP rejection is logged as a failure even before body decoding',async()=>{
 const rows=[];const original=console.log;console.log=line=>rows.push(JSON.parse(line));
 try { await clientSpan('HTTP Razorpay',async()=>({ok:false,status:401})); }
 finally {console.log=original;}
 assert.equal(rows[0].status,401);assert.equal(rows[0].level,'WARN');
});
