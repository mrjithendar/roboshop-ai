import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { createHmac } from 'node:crypto';
import { startNginx } from './helpers/nginx.mjs';
import { clientAddress } from './fixtures/previous-gateway/proxy.mjs';

async function listen(server) { server.listen(0,'127.0.0.1'); await once(server,'listening'); return server.address().port; }
test('gateway uses forwarding headers only when configured behind its trusted proxy',()=>{
  const req={headers:{'x-real-ip':'203.0.113.8'},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(clientAddress(req,false),'127.0.0.1'); assert.equal(clientAddress(req,true),'203.0.113.8');
  req.headers['x-real-ip']='invalid, 203.0.113.8'; assert.equal(clientAddress(req,true),'127.0.0.1');
});
test('NGINX serves assets and safely proxies API requests', { skip: process.env.NGINX_TEST !== 'true' ? 'Run npm run test:nginx (requires NGINX >= 1.28 or NGINX_TEST_IMAGE).' : false, timeout:30000 },async()=>{
  const dir=mkdtempSync(join(tmpdir(),'robotshop-nginx-'));
  let seen, edge;
  const backend=createServer(async(req,res)=>{
    const chunks=[]; for await(const part of req) chunks.push(part);
    seen={url:req.url,headers:req.headers,body:Buffer.concat(chunks)};
    if(req.url==='/api/fail') {res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"unavailable"}');return;}
    res.writeHead(200,{'content-type':'application/json','set-cookie':'rs_session=test; Path=/; HttpOnly; SameSite=Strict','cache-control':'public, max-age=9999'});
    res.end(JSON.stringify({ok:true}));
  });
  const probe=createServer(); const port=await listen(probe); await new Promise(r=>probe.close(r));
  const gatewayPort=await listen(backend), base=`http://127.0.0.1:${port}`;
  try {
    edge=await startNginx({port,gatewayPort,directory:dir});
    let r=await fetch(base); assert.match(await r.text(),/Find your kind of robot/); assert.equal(r.headers.get('cache-control'),'no-cache');
    assert.match(r.headers.get('content-security-policy'),/checkout.razorpay.com/);
    for(const [path,type] of [['/account','html'],['/profile.js','javascript'],['/cart','html'],['/checkout','html'],['/checkout/','html'],['/checkout.js','javascript'],['/products/arduino-alvik','html'],['/product.js','javascript'],['/product-media/turtlebot3-burger.jpg','image/jpeg'],['/product-media/atlas-x1.png','image/png'],['/illustrations/robot.svg','image/svg+xml'],['/illustrations/kit.svg','image/svg+xml'],['/app.js','javascript'],['/account.js','javascript'],['/admin.js','javascript'],['/admin','html'],['/styles.css','css'],['/images/STAN-1.png','image/png']]) {
      r=await fetch(base+path); assert.equal(r.status,200); assert.ok(r.headers.get('content-type').includes(type)); assert.match(r.headers.get('cache-control'),['/admin','/cart','/checkout','/checkout/','/account'].includes(path) || path.startsWith('/products/') ? /no-store/ : /public/); assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    }
    r=await fetch(base+'/products/arduino-alvik'); assert.match(await r.text(), /product-main/);
    assert.match((await fetch(base+'/app.js')).headers.get('cache-control'), /max-age=0, must-revalidate/);
    for(const path of ['/products/private/file','/products/private.js','/.env','/metrics','/missing.js','/src/app.ts','/tsconfig.json','/README.md','/services/ai-gateway/store.mjs']) assert.equal((await fetch(base+path)).status,404);
    r=await fetch(base+'/api/cart?test=secret-query',{headers:{cookie:'rs_session=existing','x-real-ip':'198.51.100.9','x-forwarded-for':'198.51.100.9'}});
    assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store'); assert.match(r.headers.get('set-cookie'),/HttpOnly/);
    assert.equal(seen.url,'/api/cart?test=secret-query'); assert.equal(seen.headers.cookie,'rs_session=existing');
    assert.equal(seen.headers['x-real-ip'],'127.0.0.1'); assert.equal(seen.headers['x-forwarded-for'],'127.0.0.1'); assert.equal(seen.headers.host,`127.0.0.1:${port}`);
    const raw='{ "event": "payment.captured", "space": "kept" }\n';
    const signature=createHmac('sha256','test-only').update(raw).digest('hex');
    r=await fetch(base+'/api/payments/webhook',{method:'POST',headers:{'content-type':'application/json','x-razorpay-signature':signature},body:raw});
    assert.equal(r.status,200); assert.equal(seen.body.toString(),raw); assert.equal(seen.headers['x-razorpay-signature'],signature);
    assert.equal((await fetch(base+'/api/cart',{method:'POST',body:'x'.repeat(65537)})).status,413);
    assert.equal((await fetch(base+'/api/fail')).status,503);
    assert.equal((await fetch(base+'/ready')).status,200); assert.equal(seen.url,'/api/ready');
    assert.ok(!edge.logs().includes('secret-query')); assert.ok(!edge.logs().includes(signature));
  } finally { if(edge) await edge.stop(); await new Promise(r=>backend.close(r)); rmSync(dir,{recursive:true,force:true}); }
});

test('optional HTTPS redirects HTTP and serves the storefront with security headers', {skip:process.env.NGINX_TEST!=='true',timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'robotshop-nginx-tls-'));
  let edge;
  const backend=createServer((req,res)=>res.end('{}'));
  const gatewayPort=await listen(backend);
  const probe=createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));
  const tlsProbe=createServer();const tlsPort=await listen(tlsProbe);await new Promise(r=>tlsProbe.close(r));
  try {
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'tls.key'),'-out',join(dir,'tls.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
    // This disposable test key must be readable by container UID 101 in CI.
    chmodSync(dir,0o755);chmodSync(join(dir,'tls.key'),0o644);
    edge=await startNginx({port,gatewayPort,directory:dir,tls:{port:tlsPort,directory:dir}});
    const redirect=await fetch(`http://127.0.0.1:${port}/checkout?x=1`,{redirect:'manual'});
    assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'https://localhost/checkout?x=1');
    const result=await new Promise((resolve,reject)=>{
      https.get(`https://127.0.0.1:${tlsPort}/`,{ca:readFileSync(join(dir,'tls.crt'))},res=>{
        let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
      }).on('error',reject);
    });
    assert.equal(result.status,200);assert.match(result.body,/Find your kind of robot/);
    assert.match(result.headers['strict-transport-security'],/max-age=31536000/);
    assert.match(result.headers['content-security-policy'],/checkout.razorpay.com/);
  } finally {if(edge)await edge.stop();await new Promise(r=>backend.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('subpath HTML links and module assets survive ingress prefix stripping', {skip: process.env.NGINX_TEST !== 'true', timeout:30000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'robotshop-prefix-'));
  const backend=createServer((req,res)=>res.end('{}'));
  const gatewayPort=await listen(backend);
  const probe=createServer(); const port=await listen(probe); await new Promise(r=>probe.close(r));
  let edge; const previous=process.env.FRONTEND_BASE_PATH;
  try {
    process.env.FRONTEND_BASE_PATH='/roboshop';
    edge=await startNginx({port,gatewayPort,directory:dir});
    // Traefik strips /roboshop before forwarding these requests to NGINX.
    const base=`http://127.0.0.1:${port}`;
    for(const path of ['/','/admin','/products/arduino-alvik','/cart','/checkout','/account']) {
      const html=await (await fetch(base+path)).text();
      assert.match(html,/href="\/roboshop\/styles.css"/);
      assert.match(html,/src="\/roboshop\/[a-z]+.js"/);
      assert.doesNotMatch(html,/(?:href|src)="\/(?!roboshop\/)/);
    }
    const module=await fetch(base+'/paths.js');
    assert.equal(module.status,200); assert.match(await module.text(),/import.meta.url/);
  } finally {
    if(previous===undefined) delete process.env.FRONTEND_BASE_PATH; else process.env.FRONTEND_BASE_PATH=previous;
    if(edge) await edge.stop(); await new Promise(r=>backend.close(r)); rmSync(dir,{recursive:true,force:true});
  }
});
