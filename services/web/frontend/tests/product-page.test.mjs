import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const root = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('product.html', root), 'utf8');
const source = (await Promise.all(['paths.js','account.js','product.js'].map(async name => (await readFile(new URL(name,root),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url',JSON.stringify('https://shop.example/roboshop/paths.js'))))).join('\n');
async function setup(t, product, {quantity=0, fail=false, demo=false, signedIn=false, review=null}={}) {
  const dom = new JSDOM(html,{url:'https://shop.example/roboshop/products/test-robot',runScripts:'outside-only'}); t.after(()=>dom.window.close());
  const w=dom.window, writes=[]; let savedReview=review;
  w.fetch=async(path,options={})=>{
    assert.ok(path.startsWith('/roboshop/api/'));
    let body={};
    if(path.endsWith('/auth/me')) body={user:signedIn ? {id:'customer',name:'Customer',email:'customer@example.com',role:'customer'} : null};
    else if(path.endsWith('/products/test-robot')) body={product,related:[product]};
    else if(path.endsWith('/reviews/mine')) body={review:savedReview};
    else if(path.endsWith('/reviews')) {savedReview={...JSON.parse(options.body),status:savedReview?.status || 'published'};writes.push(savedReview);body={saved:true};}
    else if(path.includes('/reviews?')) body={reviews:demo && path.includes('kind=demo') ? [{id:'demo',synthetic:true,rating:4,title:'Example',body:'Synthetic test review'}] : [],next:null,summary:{count:0,average:null}};
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
 assert.deepEqual(ui.writes,[{sku:'TEST',quantity:3}]);assert.equal(ui.$('.cart-checkout-link').getAttribute('href'),'/roboshop/cart');assert.equal(ui.$('.cart-checkout-link').hidden,false);
 assert.match(ui.$('.detail-image').src,/\/roboshop\/illustrations\/robot.svg$/);
});
test('showcase products disable purchase and omit manufacturer shopping links',async t=>{
 const ui=await setup(t,{...product,showcase:true,sources:[{label:'Bad',url:'javascript:alert(1)'},{label:'Manufacturer',url:'https://example.org/robot'}]});
 assert.equal(ui.$('.purchase-actions'),null);assert.match(ui.$('.showcase-panel').textContent,/informational/);assert.equal(ui.$('.showcase-panel a'),null);assert.equal(ui.$('.showcase-panel button').disabled,true);assert.deepEqual(ui.writes,[]);
});
test('out of stock products display a disabled purchase action',async t=>{const ui=await setup(t,{...product,instock:0});assert.equal(ui.$('.purchase-actions button').disabled,true);assert.match(ui.$('.purchase-actions button').textContent,/Out of stock/);});
test('cart failures stay visible and allow retry',async t=>{const ui=await setup(t,product,{fail:true});await submit(ui);assert.match(ui.$('.purchase-feedback').textContent,/Stock changed/);assert.equal(ui.$('.purchase-actions button').disabled,false);assert.equal(ui.$('.cart-checkout-link').hidden,true);});
test('combined quantity cannot exceed available inventory',async t=>{const ui=await setup(t,product,{quantity:5});await submit(ui);assert.equal(ui.writes.length,0);assert.match(ui.$('.purchase-feedback').textContent,/already contains/);});

test('demo reviews display separately without a dataset selector or customer rating inflation',async t=>{
 const ui=await setup(t,{...product,priceType:'on-request',showcase:true},{demo:true});
 assert.equal(ui.$('#review-kind'),null);
 assert.match(ui.w.document.body.textContent,/Price on request/);
 assert.match(ui.$('#demo-review-list').textContent,/SYNTHETIC DEMO REVIEW/);
 assert.equal(ui.$('#demo-reviews-section').hidden,false);
 assert.match(ui.$('#rating-summary').textContent,/0 reviews/);
});

 test('star selection submits its rating and restores the published review',async t=>{
 const ui=await setup(t,product,{signedIn:true});
 assert.equal(ui.$('#review-rating select'),null);
 ui.$('#review-rating input[value="3"]').click();
 assert.equal(ui.$('#rating-value').textContent,'3 out of 5 stars');
 assert.equal(ui.w.document.querySelectorAll('#review-rating .filled').length,3);
 ui.$('#review-title').value='Useful robot';ui.$('#review-body').value='Easy to set up and use at home.';
 ui.$('#review-form').dispatchEvent(new ui.w.Event('submit',{bubbles:true,cancelable:true}));
 for(let i=0;i<50&&ui.$('#review-save').disabled;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(ui.writes[0].rating,3);assert.equal(ui.$('#review-rating input:checked').value,'3');
 assert.match(ui.$('#review-status').textContent,/published/);assert.doesNotMatch(ui.$('#review-status').textContent,/moderation/);
 });

for (const status of ['hidden', 'pending']) {
  test(`editing a ${status} review does not promise publication`, async t => {
    const ui = await setup(t, product, { signedIn: true, review: { rating: 2, title: 'Original title', body: 'Original review content.', status } });
    assert.match(ui.$('#review-status').textContent, /Editing does not change its moderation status/);
    assert.doesNotMatch(ui.$('#review-status').textContent, /published immediately/);
    ui.$('#review-title').value = 'Updated title';
    ui.$('#review-form').dispatchEvent(new ui.w.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && ui.$('#review-save').disabled; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(ui.writes[0].title, 'Updated title');
    assert.match(ui.$('#review-status').textContent, new RegExp(`Your review is ${status}`));
    assert.doesNotMatch(ui.$('#review-status').textContent, /published immediately/);
  });
}

test('reference product labels price, provenance, unknowns and illustration with checkout blocked',async t=>{
 const ui=await setup(t,{...product,sku:'REF-TEST',collection:'reference',currency:'USD',priceType:'reference',showcase:true,instock:0,priceCheckedAt:'2026-10-20T15:00:00Z',priceBasis:'Manufacturer unit price; not a store offer.',unresolvedFields:['Image permission'],sources:[{label:'Manufacturer',url:'https://www.pololu.com/product/5011'}]});
 assert.match(ui.$('.detail-price').textContent,/reference price, not a store offer/);
 assert.match(ui.$('.availability').textContent,/simulated/);
 assert.match(ui.$('figcaption').textContent,/Category illustration/);
 assert.match(ui.$('.product-sources').textContent,/Image permission/);
 assert.equal(ui.$('.purchase-actions'),null);assert.deepEqual(ui.writes,[]);
});

test('demo inventory line is omitted without relabeling simulated stock as real', async t => {
 const ui=await setup(t,{...product,demo:true});
 assert.equal(ui.$('.availability'),null);
 assert.doesNotMatch(ui.$('#product-content').textContent,/Demo inventory|simulated units|In stock/);
 assert.equal(ui.$('.purchase-actions button').textContent,'Add to cart');
 ui.$('.purchase-actions input').value='2'; await submit(ui);
 assert.deepEqual(ui.writes,[{sku:'TEST',quantity:2}]);
});
test('demo stock exhaustion still disables purchase', async t => {
 const ui=await setup(t,{...product,demo:true,instock:0});
 assert.match(ui.$('.availability').textContent,/out of stock/);
 assert.equal(ui.$('.purchase-actions button').disabled,true);
});
test('product details render catalogue content and reviews link stays on this page', async t => {
 const ui=await setup(t,{...product,manufacturer:'Example manufacturer',model:'Exact model',useCases:['Classroom programming'],includedItems:['Controller'],requiredAccessories:['USB power supply'],compatibility:['Example OS'],specifications:{Interface:'USB'},unresolvedFields:['Battery capacity']});
 const content=ui.$('#product-content').textContent;
 for(const value of ['Product overview','Example manufacturer','Exact model','Applications','Classroom programming','Controller','USB power supply','Example OS','Battery capacity']) assert.ok(content.includes(value));
 assert.equal(ui.$('.product-review-anchor').getAttribute('href'),'#reviews-section');
 assert.match(ui.$('.product-sources').textContent,/Not verified: Battery capacity/);
});
test('missing supplier details stay explicit rather than inventing specifications', async t => {
 const ui=await setup(t,product);
 assert.match(ui.$('.product-information').textContent,/Package contents have not been confirmed/);
 assert.match(ui.$('.product-information').textContent,/Supported software.*have not been confirmed/);
 assert.match(ui.$('.product-information').textContent,/Detailed specifications are not yet available/);
});
