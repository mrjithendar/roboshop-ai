import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const code=readFileSync(new URL('../widget.js',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setTimeout(r,10));
async function setup(t,authenticated=false,external=false){
 const dom=new JSDOM('<body><main>Store</main><script src="https://shop.example/roboshop/finder/widget.js"></script></body>',{url:external?'https://other.example/':'https://shop.example/roboshop/products/item',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 Object.defineProperty(w.document,'currentScript',{value:w.document.querySelector('script')});let shadow,poll,healthy=true,aiConfigured=true,status=200;const calls=[];
 const original=w.HTMLElement.prototype.attachShadow;w.HTMLElement.prototype.attachShadow=function(o){shadow=original.call(this,o);return shadow};w.setInterval=fn=>{poll=fn;return 1};
 w.fetch=async(url,options)=>{calls.push({url:String(url),options});return String(url).endsWith('/chat')?{ok:status===200,status,json:async()=>({answer:'<img src=x>',products:[{name:'Robot',slug:'item'}]})}:{ok:healthy,json:async()=>({available:healthy,authenticated,aiConfigured})}};
 w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await settle();
 return{w,shadow,calls,poll,setAI:v=>aiConfigured=v,setStatus:n=>status=n,setHealth:v=>healthy=v,submit:async()=>{shadow.querySelector('textarea').value='Help me choose';shadow.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle()}};
}
test('guest sees login link, cannot submit, and never loads Turnstile',async t=>{
 const ui=await setup(t);ui.shadow.querySelector('#open').click();await settle();
 assert.equal(ui.shadow.querySelector('#login-required').hidden,false);assert.equal(ui.shadow.querySelector('form').hidden,true);
 const link=new URL(ui.shadow.querySelector('#login-link').href);assert.equal(link.pathname,'/roboshop/login');assert.equal(link.searchParams.get('returnTo'),'/roboshop/products/item');
 await ui.submit();assert.ok(!ui.calls.some(c=>c.url.endsWith('/chat')));assert.equal(ui.w.document.querySelector('script[src*="cloudflare"]'),null);
});
test('signed-in user chats without challenge and receives safe product links',async t=>{
 const ui=await setup(t,true);ui.shadow.querySelector('#open').click();await settle();await ui.submit();
 assert.equal(ui.shadow.querySelector('#login-required').hidden,true);assert.equal(ui.shadow.querySelector('#send').disabled,false);
 assert.equal(ui.shadow.querySelector('#messages img'),null);assert.equal(ui.shadow.querySelector('#messages a').href,'https://shop.example/roboshop/products/item');
 assert.deepEqual(JSON.parse(ui.calls.find(c=>c.url.endsWith('/chat')).options.body),{message:'Help me choose',context:''});assert.ok(ui.calls.every(c=>c.options.credentials==='same-origin'));
});
test('expired login switches to sign in and prevents further chat',async t=>{
 const ui=await setup(t,true);ui.shadow.querySelector('#open').click();await settle();ui.setStatus(401);await ui.submit();
 assert.equal(ui.shadow.querySelector('#login-required').hidden,false);assert.equal(ui.shadow.querySelector('form').hidden,true);const count=ui.calls.filter(c=>c.url.endsWith('/chat')).length;await ui.submit();assert.equal(ui.calls.filter(c=>c.url.endsWith('/chat')).length,count);
});
for(const status of [400,403,429,503])test(`failure ${status} keeps draft and conversation`,async t=>{
 const ui=await setup(t,true);ui.shadow.querySelector('#open').click();await settle();ui.setStatus(status);await ui.submit();assert.equal(ui.shadow.querySelector('textarea').value,'Help me choose');assert.equal(ui.shadow.querySelector('section').hidden,false);assert.equal(ui.shadow.querySelector('#error').hidden,false);
});
test('third-party embed omits cookies and links to the store login',async t=>{const ui=await setup(t,false,true);assert.ok(ui.calls.every(c=>c.options.credentials==='omit'));assert.equal(ui.shadow.querySelector('#login-link').href,'https://shop.example/roboshop/login')});
test('service outage hides closed widget without affecting store',async t=>{const ui=await setup(t);Object.defineProperty(ui.w.document,'hidden',{value:false});ui.setHealth(false);await ui.poll();await settle();assert.equal(ui.w.document.querySelector('#finder-widget').hidden,true);assert.equal(ui.w.document.querySelector('main').textContent,'Store')});

test('unconfigured AI stays visible, blocks chat, and recovers after configuration',async t=>{
 const ui=await setup(t,true);Object.defineProperty(ui.w.document,'hidden',{value:false});
 ui.setAI(false);await ui.poll();await settle();
 assert.equal(ui.w.document.querySelector('#finder-widget').hidden,false);
 assert.match(ui.shadow.querySelector('#error').textContent,/Please connect an LLM to get results/);
 assert.equal(ui.shadow.querySelector('#send').disabled,true);
 await ui.submit();assert.ok(!ui.calls.some(c=>c.url.endsWith('/chat')));
 ui.setAI(true);await ui.poll();await settle();
 assert.equal(ui.shadow.querySelector('#send').disabled,false);
 assert.equal(ui.shadow.querySelector('#error').hidden,true);
});
