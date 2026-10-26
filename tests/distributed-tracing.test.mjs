import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTemplate,traceState,httpName} from '../services/catalogue-service/lib/trace-routes.mjs';
import {context,request,exportSpan} from '../services/catalogue-service/lib/runtime.mjs';
test('route names omit identifiers, query strings, and unmatched paths',()=>{
 assert.equal(routeTemplate('/api/catalogue/search/private?q=secret'),'/api/catalogue/search/{query}');
 assert.equal(routeTemplate('/roboshop/api/products/private'),'/roboshop/api/products/{product_id}');
 assert.equal(httpName('GET','/unknown/private'),'GET');
 assert.equal(traceState('vendor=value'),'vendor=value');
 assert.equal(traceState('vendor=one,vendor=two'),'');
});
test('HTTP client retains trace and state without forwarding payload into telemetry',async()=>{
 const old=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>({ok:true})}};
 try{await context.run({traceId:'a'.repeat(32),spanId:'b'.repeat(16),flags:'01',tracestate:'vendor=value',service:'catalogue-service'},()=>request('http://users/api/auth/me'));
 assert.match(calls[0][1].headers.traceparent,/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-/);assert.equal(calls[0][1].headers.tracestate,'vendor=value');}
 finally{global.fetch=old;}
});
test('successful health filtered while error exported with stable resources',async()=>{
 const old=global.fetch,env={...process.env},calls=[];
 process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='http://collector';process.env.OTEL_SERVICE_VERSION='test-sha';
 global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true}};
 try{const ctx={traceId:'a'.repeat(32),spanId:'b'.repeat(16),flags:'01'};
 exportSpan('catalogue-service',ctx,Date.now(),'GET /ready',200,{'http.route':'/ready'});
 assert.equal(calls.length,0);
 exportSpan('catalogue-service',ctx,Date.now(),'GET /ready',503,{'http.route':'/ready'});
 assert.equal(calls.length,1);assert.match(JSON.stringify(calls),/service.namespace/);assert.match(JSON.stringify(calls),/test-sha/);
 await new Promise(resolve=>setImmediate(resolve));}
 finally{global.fetch=old;process.env=env;}
});
test('all local clients export actual response status without changing caller errors or retries', async()=>{
 const savedFetch=global.fetch, savedEnv={...process.env};
 process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='http://collector';
 try {
  for(const service of ['catalogue-service','payment-service']) {
   const runtime=await import(`../services/${service}/lib/runtime.mjs`);
   for(const outcome of [429,400,503,200,'connection','timeout','retry-connection']) {
    let attempts=0;const spans=[];
    global.fetch=async(url,options)=>{
     if(url==='http://collector'){spans.push(JSON.parse(options.body).resourceSpans[0].scopeSpans[0].spans[0]);return {ok:true};}
     attempts++;
     if(outcome==='connection'||outcome==='retry-connection'&&attempts===2) throw new TypeError('private connection info');
     if(outcome==='timeout')throw new DOMException('private timeout','TimeoutError');
     const status=outcome==='retry-connection'?503:outcome;
     return {status,ok:status===200,json:async()=>({ok:true}),body:{cancel:async()=>{}}};
    };
    if(outcome===200)assert.deepEqual(await runtime.request('http://dependency/api/products'),{ok:true});
    else await assert.rejects(runtime.request('http://dependency/api/products'),e=>e.status===(typeof outcome==='number'?502:503)&&!e.message.includes('private'));
    const attrs=Object.fromEntries(spans[0].attributes.map(a=>[a.key,a.value.intValue??a.value.stringValue]));
    assert.equal(attrs['http.response.status_code'],typeof outcome==='number'?String(outcome):undefined,`${service} ${outcome}`);
    assert.equal(attempts,[503,'connection','retry-connection'].includes(outcome)?2:1);
    assert.equal(spans[0].status.code,outcome===200?0:2);
   }
   // Writes must never acquire safe-read retries.
   let writes=0;global.fetch=async(url)=>{if(url==='http://collector')return{ok:true};writes++;return{ok:false,status:503}};
   await assert.rejects(runtime.request('http://dependency/api/payment/orders',{method:'POST',body:'{}'}));assert.equal(writes,1);
  }
 } finally {global.fetch=savedFetch;process.env=savedEnv;}
});
test('Node and Python vocabulary parity, including all added admin routes',async()=>{
 const {execFileSync}=await import('node:child_process');
 const vocabulary=JSON.parse(execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,'services/ai-gateway/lib');import trace_routes as r;print(json.dumps(sorted(r.STATIC)))"],{encoding:'utf8'}));
 for(const service of ['catalogue-service','payment-service']){
  const routes=await import(`../services/${service}/lib/trace-routes.mjs`);
  for(const route of vocabulary){assert.equal(routes.httpName('GET',route),'GET '+route);assert.equal(routes.httpName('POST','/roboshop'+route),'POST /roboshop'+route);}
  assert.equal(routes.quietRoute('/roboshop/health'),true);
 }
});
test('payment transport preserves provider status and never retries order writes',async()=>{
 const {Razorpay}=await import('../services/payment-service/razorpay.mjs');
 const old=global.fetch,env={...process.env},spans=[];
 process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='http://collector';
 global.fetch=async(url,opts)=>{spans.push(JSON.parse(opts.body).resourceSpans[0].scopeSpans[0].spans[0]);return{ok:true}};
 try {
  for(const status of [429,400,503]){
   let attempts=0;
   const provider=new Razorpay({PAYMENT_MODE:'test',RAZORPAY_KEY_ID:'rzp_test_UNIT',RAZORPAY_KEY_SECRET:'mock',RAZORPAY_WEBHOOK_SECRET:'mock',PAYMENT_SERVICE_TOKEN:'mock'},async()=>{attempts++;return{ok:false,status}});
   await assert.rejects(provider.api('/orders',{}),e=>e.status===502);
   assert.equal(attempts,1);
   assert.equal(spans.at(-1).attributes.find(a=>a.key==='http.response.status_code').value.intValue,String(status));
  }
 }finally{global.fetch=old;process.env=env;}
});
