import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = (await readFile(new URL('../dist/paths.js', import.meta.url), 'utf8')).replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify('https://shop.example/roboshop/paths.js'));
const asOf = new Date().toISOString().slice(0, 10);
async function setup(t, { saved, fail=false, language='en-IN' }={}) {
  const dom = new JSDOM('<div id="currency-control" hidden><button id="currency-button" aria-expanded="false">Currency</button><div id="currency-menu" hidden></div><select id="display-currency" disabled></select><p id="currency-status"></p></div><p id="price"></p>', {url:'https://shop.example/roboshop/', runScripts:'outside-only'});
  t.after(() => dom.window.close()); const w = dom.window;
  Object.defineProperty(w.navigator, 'language', {value:language});
  if(saved) w.localStorage.setItem('roboshop.displayCurrency', saved);
  w.fetch=async url => { assert.match(url,/^\/roboshop\/api\/currency\/rates\?country=/); if(fail) throw new Error('offline'); return {ok:true,json:async()=>({displayOnly:true, asOf, rates:{EUR:1,USD:1.2,INR:90,JPY:150,GBP:0.8,SGD:1.4,AUD:1.6},suggestedCurrency:language==='en-IN'?'INR':'USD'})}; };
  w.eval(source+'\nwindow.fxTest={initCurrency,bindProductPrice,formatProductPrice};');
  const p = {price:120,currency:'USD',priceType:'reference',collection:'reference'};
  w.fxTest.bindProductPrice(w.document.querySelector('#price'), p);
  await w.fxTest.initCurrency(); return {w,p,text:()=>w.document.querySelector('#price').textContent};
}
test('browser country selects INR; original reference amount stays intact',async t=>{
 const {w,p,text}=await setup(t); assert.match(text(),/9,000/);assert.doesNotMatch(text(),/original|ECB|≈/);assert.match(text(),/reference price, not a store offer/);assert.equal(p.price,120);assert.equal(p.currency,'USD');assert.equal(w.document.querySelector('#display-currency').value,'INR');
});
test('only five currencies, saved preference persists and obsolete choices use the region',async t=>{
 const {w,text}=await setup(t,{saved:'JPY'}); assert.match(text(),/9,000/);
 const select=w.document.querySelector('select');
 assert.deepEqual(Array.from(select.options,o=>o.value),['INR','USD','GBP','SGD','AUD']);
 select.value='GBP';select.dispatchEvent(new w.Event('change'));
 assert.match(text(),/80.00/);assert.equal(w.localStorage.getItem('roboshop.displayCurrency'),'GBP');
 const saved=await setup(t,{saved:'GBP'});assert.match(saved.text(),/80.00/);
});
test('header button opens currency choices and closes on selection or Escape',async t=>{
 const {w}=await setup(t);const button=w.document.querySelector('#currency-button'),menu=w.document.querySelector('#currency-menu');
 assert.equal(button.textContent,'INR');button.click();assert.equal(menu.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');
 const select=w.document.querySelector('select');select.value='USD';select.dispatchEvent(new w.Event('change'));
 assert.equal(button.textContent,'USD');assert.equal(menu.hidden,true);
 button.click();button.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(menu.hidden,true);
});
test('service failure keeps original prices and visible notice',async t=>{
 const {w,text}=await setup(t,{fail:true});assert.match(text(),/120\.00/);assert.doesNotMatch(text(),/≈/);assert.match(w.document.querySelector('#currency-status').textContent,/unavailable/);
});
test('unknown prices remain unknown; demo prices remain labelled',async t=>{
 const {w}=await setup(t);assert.equal(w.fxTest.formatProductPrice({price:0,priceType:'on-request'}),'Price on request');assert.match(w.fxTest.formatProductPrice({price:120,currency:'USD',demo:true}),/demo price/);
});
