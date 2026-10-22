import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';

// Exercise actual HTTP completion, including finally: syntax checks cannot detect
// block-scoped references used by a different block.
for (const format of ['json','text']) for (const service of ['catalogue-service','product-ingestion','payment-service','recommendation-service','sre-copilot']) {
 test(`${service} ${format}: success, rejection, missing route and probes leave server alive`, async t => {
  const {serve,json,HttpError}=await import(`../services/${service}/lib/runtime.mjs`);
  const originalFormat=process.env.LOG_FORMAT; process.env.LOG_FORMAT=format;
  const original = console.log, lines=[];
  console.log=(line)=>lines.push(line);
  const before=new Map(['SIGINT','SIGTERM'].map(s=>[s,process.listeners(s)]));
  const server=serve(service,0,async(req,res,url)=>{
    if(url.pathname==='/api/products') return json(res,{products:[]});
    if(url.pathname==='/api/payment/verify') throw new HttpError(401,'Access denied.');
    if(url.pathname==='/api/recommendations') throw new Error('PRIVATE-EXCEPTION');
  });
  t.after(async()=>{
    console.log=original;
    if(originalFormat===undefined)delete process.env.LOG_FORMAT;else process.env.LOG_FORMAT=originalFormat;
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    for(const [signal,listeners] of before) for(const listener of process.listeners(signal)) if(!listeners.includes(listener)) process.removeListener(signal,listener);
  });
  if(!server.listening) await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const [path,status] of [['/api/products?token=PRIVATE-QUERY',200],['/api/payment/verify',401],['/api/recommendations',500],['/missing',404],['/health',200],['/metrics',200],['/api/products',200]]) {
    const response=await fetch(base+path);
    assert.equal(response.status,status);await response.text();
  }
  await new Promise(resolve=>setImmediate(resolve));
  const records=lines.map(line=>format==='json'?JSON.parse(line):{event:/event=([^ ]+)/.exec(line)?.[1],status:Number(/status=(\d+)/.exec(line)?.[1])});
  assert.ok(records.some(r=>r.event==='catalogue_read_completed'));
  assert.ok(records.some(r=>r.event==='payment_verification_failed'));
  assert.ok(records.some(r=>r.event==='request_completed'&&r.status===500));
  assert.ok(!lines.join('').includes('PRIVATE-'));
 });
}
