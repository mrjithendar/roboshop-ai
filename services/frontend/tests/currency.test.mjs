import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = (await readFile(new URL('../dist/paths.js', import.meta.url), 'utf8')).replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify('https://shop.example/roboshop/paths.js'));
const asOf = new Date().toISOString().slice(0, 10);
async function setup(t, { saved, fail=false, language='en-IN' }={}) {
  const dom = new JSDOM('<div id="currency-control" hidden><select id="display-currency" disabled></select><p id="currency-status"></p></div><p id="price"></p>', {url:'https://shop.example/roboshop/', runScripts:'outside-only'});
  t.after(() => dom.window.close()); const w = dom.window;
  Object.defineProperty(w.navigator, 'language', {value:language});
  if(saved) w.localStorage.setItem('roboshop.displayCurrency', saved);
  w.fetch=async url => { assert.match(url,/^\/roboshop\/api\/currency\/rates\?country=/); if(fail) throw new Error('offline'); return {ok:true,json:async()=>({displayOnly:true, asOf, rates:{EUR:1,USD:1.2,INR:90,JPY:150},suggestedCurrency:language==='en-IN'?'INR':'USD'})}; };
  w.eval(source+'\nwindow.fxTest={initCurrency,bindProductPrice,formatProductPrice};');
  const p = {price:120,currency:'USD',priceType:'reference',collection:'reference'};
  w.fxTest.bindProductPrice(w.document.querySelector('#price'), p);
  await w.fxTest.initCurrency(); return {w,p,text:()=>w.document.querySelector('#price').textContent};
}
test('browser country selects INR; original reference amount stays intact',async t=>{
 const {w,p,text}=await setup(t); assert.match(text(),/9,000/);assert.doesNotMatch(text(),/original|ECB|≈/);assert.match(text(),/reference price, not a store offer/);assert.equal(p.price,120);assert.equal(p.currency,'USD');assert.equal(w.document.querySelector('#display-currency').value,'INR');
});
test('saved override and selector persist, including original currency',async t=>{
 const {w,text}=await setup(t,{saved:'JPY'});assert.match(text(),/15,000/);const select=w.document.querySelector('select');select.value='original';select.dispatchEvent(new w.Event('change'));assert.doesNotMatch(text(),/≈/);assert.equal(w.localStorage.getItem('roboshop.displayCurrency'),'original');
});
test('service failure keeps original prices and visible notice',async t=>{
 const {w,text}=await setup(t,{fail:true});assert.match(text(),/120\.00/);assert.doesNotMatch(text(),/≈/);assert.match(w.document.querySelector('#currency-status').textContent,/unavailable/);
});
test('unknown prices remain unknown; demo prices remain labelled',async t=>{
 const {w}=await setup(t);assert.equal(w.fxTest.formatProductPrice({price:0,priceType:'on-request'}),'Price on request');assert.match(w.fxTest.formatProductPrice({price:120,currency:'USD',demo:true}),/demo price/);
});
