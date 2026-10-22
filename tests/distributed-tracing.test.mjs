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
