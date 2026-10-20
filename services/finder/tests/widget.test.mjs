import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const code = readFileSync(new URL('../widget.js', import.meta.url), 'utf8');
async function setup(t, healthy = true) {
  const dom = new JSDOM('<body><main>Store remains available</main><script src="https://agent.example/finder/widget.js" data-store="https://shop.example/roboshop/" data-label="Ask us"></script></body>', { url:'https://other.example', runScripts:'outside-only' });
  t.after(()=>dom.window.close()); const w=dom.window;
  Object.defineProperty(w.document, 'currentScript', {value:w.document.querySelector('script')});
  let shadow, poll; const original=w.HTMLElement.prototype.attachShadow;
  w.HTMLElement.prototype.attachShadow=function(options){shadow=original.call(this,options);return shadow;};
  w.setInterval=fn=>{poll=fn;return 1;};
  let challenge; w.turnstile={render: (el, options)=>{challenge=options; return 'test';}, reset:()=>{}, remove:()=>{}};
  const calls=[];
  w.fetch=async(url,options)=>{calls.push({url:String(url),options});return{ok:healthy,json:async()=>String(url).endsWith('/chat')?{answer:'<img src=x onerror=alert(1)>',products:[{name:'Result',slug:'item'}]}:{available:healthy,siteKey:'site'}};};
  w.eval(code); w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await new Promise(r=>setTimeout(r,10));
  return {w,shadow,calls,poll,verify:()=>challenge.callback('test-token'),expire:()=>challenge['expired-callback'](),setHealth:value=>healthy=value};
}
test('embeds independently, renders safely and uses configured store links',async t=>{
 const {w,shadow,calls,verify}=await setup(t);
 assert.equal(w.document.querySelector('#finder-widget').hidden,false);
 assert.equal(shadow.querySelector('#open').textContent,'Ask us');
 shadow.querySelector('#open').click();assert.equal(shadow.querySelector('section').hidden,false);
 assert.equal(shadow.querySelector('#send').disabled,true); verify();
 shadow.querySelector('textarea').value='hello';shadow.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,10));
 assert.equal(shadow.querySelectorAll('img').length,0);
 assert.equal(shadow.querySelector('a').href,'https://shop.example/roboshop/products/item');
 assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('/chat')).options.body).challengeToken,'test-token');
 assert.equal(shadow.querySelector('#send').disabled,true);
 assert.ok(calls.every(c=>c.options.credentials==='omit'));
});
test('unavailable at startup never shows launcher or changes host content',async t=>{
 const {w}=await setup(t,false);assert.equal(w.document.querySelector('#finder-widget').hidden,true);assert.equal(w.document.querySelector('main').textContent,'Store remains available');
});
test('running widget hides when service becomes unavailable',async t=>{
 const {w,poll,setHealth}=await setup(t);Object.defineProperty(w.document,'hidden',{value:false});setHealth(false);await poll();await new Promise(r=>setTimeout(r,10));assert.equal(w.document.querySelector('#finder-widget').hidden,true);
});

test('unverified and expired challenges cannot submit', async t=>{
 const {w,shadow,calls,verify,expire}=await setup(t); shadow.querySelector('#open').click(); shadow.querySelector('textarea').value='help';
 const submit=()=>shadow.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
 submit(); verify(); expire(); submit(); await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.filter(c=>c.url.endsWith('/chat')).length,0);
});
