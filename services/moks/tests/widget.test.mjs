import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const code=readFileSync(new URL('../widget.js',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setTimeout(r,10));
async function setup(t,authenticated=false,external=false){
 const dom=new JSDOM('<body><main>Store</main><script src="https://shop.example/roboshop/moks/widget.js"></script></body>',{url:external?'https://other.example/':'https://shop.example/roboshop/products/item',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 Object.defineProperty(w.document,'currentScript',{value:w.document.querySelector('script')});let shadow,poll,healthy=true,aiConfigured=true,status=200,answer='<img src=x>',turns=[],historyOk=true;const calls=[];
 const original=w.HTMLElement.prototype.attachShadow;w.HTMLElement.prototype.attachShadow=function(o){shadow=original.call(this,o);return shadow};w.setInterval=fn=>{poll=fn;return 1};
 w.fetch=async(url,options)=>{calls.push({url:String(url),options});return String(url).endsWith('/chat')?{ok:status===200,status,json:async()=>({answer,products:[{name:'Robot',slug:'item'}]})}:String(url).endsWith('/history')?{ok:historyOk,status:historyOk?200:503,json:async()=>({turns})}:{ok:healthy,json:async()=>({available:healthy,authenticated,aiConfigured})}};
 w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await settle();
 return{w,shadow,calls,poll,setAnswer:value=>answer=value,setTurns:value=>turns=value,setHistoryOk:value=>historyOk=value,setAuthenticated:value=>authenticated=value,setAI:v=>aiConfigured=v,setStatus:n=>status=n,setHealth:v=>healthy=v,submit:async()=>{shadow.querySelector('textarea').value='Help me choose';shadow.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle()}};
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
 assert.deepEqual(JSON.parse(ui.calls.find(c=>c.url.endsWith('/chat')).options.body),{message:'Help me choose'});assert.ok(ui.calls.every(c=>c.options.credentials==='same-origin'));
});
test('expired login switches to sign in and prevents further chat',async t=>{
 const ui=await setup(t,true);ui.shadow.querySelector('#open').click();await settle();ui.setStatus(401);await ui.submit();
 assert.equal(ui.shadow.querySelector('#login-required').hidden,false);assert.equal(ui.shadow.querySelector('form').hidden,true);const count=ui.calls.filter(c=>c.url.endsWith('/chat')).length;await ui.submit();assert.equal(ui.calls.filter(c=>c.url.endsWith('/chat')).length,count);
});
for(const status of [400,403,429,503])test(`failure ${status} keeps draft and conversation`,async t=>{
 const ui=await setup(t,true);ui.shadow.querySelector('#open').click();await settle();ui.setStatus(status);await ui.submit();assert.equal(ui.shadow.querySelector('textarea').value,'Help me choose');assert.equal(ui.shadow.querySelector('section').hidden,false);assert.equal(ui.shadow.querySelector('#error').hidden,false);
});
test('third-party embed omits cookies and links to the store login',async t=>{const ui=await setup(t,false,true);assert.ok(ui.calls.every(c=>c.options.credentials==='omit'));assert.equal(ui.shadow.querySelector('#login-link').href,'https://shop.example/roboshop/login')});
test('service outage hides closed widget without affecting store',async t=>{const ui=await setup(t);Object.defineProperty(ui.w.document,'hidden',{value:false});ui.setHealth(false);await ui.poll();await settle();assert.equal(ui.w.document.querySelector('#moks-widget').hidden,true);assert.equal(ui.w.document.querySelector('main').textContent,'Store')});

test('unconfigured AI stays visible, blocks chat, and recovers after configuration',async t=>{
 const ui=await setup(t,true);Object.defineProperty(ui.w.document,'hidden',{value:false});
 ui.setAI(false);await ui.poll();await settle();
 assert.equal(ui.w.document.querySelector('#moks-widget').hidden,false);
 assert.match(ui.shadow.querySelector('#error').textContent,/Please connect an LLM to get results/);
 assert.equal(ui.shadow.querySelector('#send').disabled,true);
 await ui.submit();assert.ok(!ui.calls.some(c=>c.url.endsWith('/chat')));
 ui.setAI(true);await ui.poll();await settle();
 assert.equal(ui.shadow.querySelector('#send').disabled,false);
 assert.equal(ui.shadow.querySelector('#error').hidden,true);
});

test('replies render readable headings, emphasis, lists and product cards', async t=>{
 const ui=await setup(t,true);
 ui.setAnswer('### Personal assistance\n\nTry **PetPal P3**.\n\n- **Price:** ₹146\n- Confirm its capabilities.\n\n1. Choose a task\n2. Set a budget');
 await ui.submit();
 const reply=ui.shadow.querySelector('.reply');
 assert.equal(reply.tagName,'DIV');
 assert.equal(reply.querySelector('h3').textContent,'Personal assistance');
 assert.equal(reply.querySelector('strong').textContent,'PetPal P3');
 assert.equal(reply.querySelectorAll('ul li').length,2);
 assert.equal(reply.querySelectorAll('ol li').length,2);
 assert.ok(reply.querySelector('.product-links a'));
 assert.doesNotMatch(reply.textContent,/###|\*\*/);
});
test('model markup, image and javascript links remain inert even inside bold text',async t=>{
 const ui=await setup(t,true);
 ui.setAnswer('**<img src=x onerror=alert(1)>**\n\n<script>alert(1)</script> [click](javascript:alert(1))\n- <svg onload=alert(1)>');
 await ui.submit();
 const reply=ui.shadow.querySelector('.reply');
 assert.equal(reply.querySelector('img,script,svg,iframe'),null);
 assert.ok(reply.textContent.includes('<script>'));
 assert.equal(reply.querySelectorAll('a').length,1);
 assert.ok(reply.querySelector('a').href.startsWith('https://shop.example/roboshop/products/'));
});

test('saved conversation restores on opening and clears after logout',async t=>{
 const ui=await setup(t,true);Object.defineProperty(ui.w.document,'hidden',{value:false});ui.setTurns([{message:'My budget is 500',answer:'**Saved reply**',products:[{name:'Robot',slug:'item'}]}]);
 await ui.poll();await settle();
 assert.match(ui.shadow.querySelector('#messages').textContent,/My budget is 500/);
 assert.equal(ui.shadow.querySelector('.reply strong').textContent,'Saved reply');
 assert.ok(ui.shadow.querySelector('.product-links a'));
 ui.setAuthenticated(false);await ui.poll();await settle();
 assert.equal(ui.shadow.querySelector('#messages').textContent,'');
});
test('history outage blocks new messages rather than silently losing continuity',async t=>{
 const ui=await setup(t,true);Object.defineProperty(ui.w.document,'hidden',{value:false});ui.setHistoryOk(false);await ui.poll();await settle();
 assert.equal(ui.shadow.querySelector('#send').disabled,true);
 assert.match(ui.shadow.querySelector('#error').textContent,/saved conversation could not be loaded/);
 ui.setHistoryOk(true);await ui.poll();await settle();assert.equal(ui.shadow.querySelector('#send').disabled,false);
});

test('cards show current price and provenance; busy and timeout keep the draft without resending',async t=>{
 const ui=await setup(t,true);ui.shadow.querySelector('#open').click();await settle();
 const original=ui.w.fetch;let chats=0,mode='cards';
 ui.w.fetch=async(url,options)=>{if(!String(url).endsWith('/chat'))return original(url,options);chats++;
  if(mode==='busy')return{ok:false,status:429,json:async()=>({code:'assistant-busy'})};
  if(mode==='timeout'){const e=new Error('timed out');e.name='TimeoutError';throw e;}
  if(mode==='slow')return new Promise(()=>{});
  return{ok:true,status:200,json:async()=>({answer:'Try **Rover**.',products:[{name:'Rover',slug:'ref',price:194.95,currency:'USD',priceType:'reference',label:'Reference price, not sold here'}]})};};
 await ui.submit();
 const note=ui.shadow.querySelector('.product-links .provenance');
 assert.match(note.textContent,/194\.95/);assert.match(note.textContent,/Reference price, not sold here/);
 mode='busy';await ui.submit();assert.match(ui.shadow.querySelector('#error').textContent,/Moks is busy/);assert.equal(ui.shadow.querySelector('textarea').value,'Help me choose');
 mode='timeout';const before=chats;await ui.submit();
 assert.match(ui.shadow.querySelector('#error').textContent,/took too long/);assert.equal(chats,before+1);assert.equal(ui.shadow.querySelector('textarea').value,'Help me choose');
 mode='slow';const form=ui.shadow.querySelector('form');ui.shadow.querySelector('textarea').value='first';
 form.dispatchEvent(new ui.w.Event('submit',{cancelable:true}));await settle();
 ui.shadow.querySelector('textarea').value='second';form.dispatchEvent(new ui.w.Event('submit',{cancelable:true}));await settle();
 assert.equal(chats,before+2,'a second submission while busy is ignored');assert.equal(ui.shadow.querySelector('#send').disabled,true);
});
