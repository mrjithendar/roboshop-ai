import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const root = new URL('../services/frontend/dist/', import.meta.url);
const html = await readFile(new URL('product.html', root), 'utf8');
const source = (await Promise.all(['paths.js','account.js','product.js'].map(async name => (await readFile(new URL(name,root),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url',JSON.stringify('https://shop.example/roboshop/paths.js'))))).join('\n');
async function setup(t, product, {quantity=0, fail=false}={}) {
  const dom = new JSDOM(html,{url:'https://shop.example/roboshop/products/test-robot',runScripts:'outside-only'}); t.after(()=>dom.window.close());
  const w=dom.window, writes=[];
  w.fetch=async(path,options={})=>{
    assert.ok(path.startsWith('/roboshop/api/'));
    let body={};
    if(path.endsWith('/auth/me')) body={user:null};
    else if(path.endsWith('/products/test-robot')) body={product,related:[product]};
    else if(path.includes('/reviews?')) body={reviews:[],next:null,summary:{count:0,average:null}};
    else if(path.endsWith('/cart')) {
      if(options.method==='POST') {writes.push(JSON.parse(options.body)); if(fail)return {ok:false,json:async()=>({error:'Stock changed. Please retry.'})};}
      body={items:quantity?[{sku:product.sku,quantity}]:[]};
    } else throw new Error('Unexpected request '+path);
    return {ok:true,json:async()=>body};
  };
  await w.eval(`(async()=>{${source}})()`);
  return {w,writes,$:s=>w.document.querySelector(s)};
}
const product={sku:'TEST',slug:'test-robot',name:'Test robot',description:'Educational platform',price:25,instock:5,categories:['robot'],image:'/images/placeholder.png',productType:'complete robot'};
async function submit(ui) {ui.$('.purchase-actions').dispatchEvent(new ui.w.Event('submit',{bubbles:true,cancelable:true}));for(let i=0;i<50&&ui.$('.purchase-actions button').disabled;i++)await new Promise(r=>setTimeout(r,5));}
test('legacy sale product can add quantity and existing cart items under /roboshop',async t=>{
 const ui=await setup(t,product,{quantity:1});assert.equal(ui.$('.purchase-actions button').textContent,'Add to cart');ui.$('.purchase-actions input').value='2';await submit(ui);
 assert.deepEqual(ui.writes,[{sku:'TEST',quantity:3}]);assert.equal(ui.$('.cart-checkout-link').getAttribute('href'),'/roboshop/?cart=1');assert.equal(ui.$('.cart-checkout-link').hidden,false);
 assert.match(ui.$('.detail-image').src,/\/roboshop\/illustrations\/robot.svg$/);
});
test('showcase products disable purchase and omit manufacturer shopping links',async t=>{
 const ui=await setup(t,{...product,showcase:true,sources:[{label:'Bad',url:'javascript:alert(1)'},{label:'Manufacturer',url:'https://example.org/robot'}]});
 assert.equal(ui.$('.purchase-actions'),null);assert.match(ui.$('.showcase-panel').textContent,/informational/);assert.equal(ui.$('.showcase-panel a'),null);assert.equal(ui.$('.showcase-panel button').disabled,true);assert.deepEqual(ui.writes,[]);
});
test('out of stock products display a disabled purchase action',async t=>{const ui=await setup(t,{...product,instock:0});assert.equal(ui.$('.purchase-actions button').disabled,true);assert.match(ui.$('.purchase-actions button').textContent,/Out of stock/);});
test('cart failures stay visible and allow retry',async t=>{const ui=await setup(t,product,{fail:true});await submit(ui);assert.match(ui.$('.purchase-feedback').textContent,/Stock changed/);assert.equal(ui.$('.purchase-actions button').disabled,false);assert.equal(ui.$('.cart-checkout-link').hidden,true);});
test('combined quantity cannot exceed available inventory',async t=>{const ui=await setup(t,product,{quantity:5});await submit(ui);assert.equal(ui.writes.length,0);assert.match(ui.$('.purchase-feedback').textContent,/already contains/);});
