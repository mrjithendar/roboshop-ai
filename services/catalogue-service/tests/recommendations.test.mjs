import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueRoutes } from '../routes.mjs';
const item=(sku,extra={})=>({sku,name:'Security '+sku,description:'Protection robot',categories:['security'],currency:'INR',price:199,instock:4,...extra});
const rows=[item('A'),item('B',{price:299}),item('C',{instock:0}),item('OLD',{archived:true}),item('USD',{price:99,currency:'USD'})];
function database(data=rows){return {command:async()=>{},collection(){return {find(){return {sort(){return this;},limit(){return this;},async toArray(){return data;}};}};}};}
async function call(path,db=database()){
 const res={writeHead(code){this.status=code;},end(body){this.body=JSON.parse(body);}};
 await catalogueRoutes(db)({method:'GET'},res,new URL(path,'http://catalogue'));return res;
}
test('recommendation contract, ranking, currencies and exclusions are preserved',async()=>{
 const result=await call('/api/recommendations?q=guard&budget=250&category=security&limit=2');
 assert.equal(result.body.strategy,'catalogue-keyword-ranking');assert.equal(result.body.personalized,false);
 // Mixed currencies require an explicit currency in the budget query.
 assert.deepEqual(result.body.products,[]);
 const picks=(await call('/api/recommendations?q=guard%20INR&budget=250')).body.products;
 assert.deepEqual(picks.map(p=>p.sku),['A']);assert.equal(picks[0].currency,'INR');assert.ok(picks[0].reason);
 assert.deepEqual((await call('/api/recommendations?q=guard&exclude=A,B,USD')).body.products,[]);
 assert.deepEqual((await call('/api/recommendations?q=unknownplanet')).body.products,[]);
 assert.deepEqual((await call('/api/recommendations?category=missing')).body.products,[]);
 assert.equal((await call('/api/recommendations?limit=1')).body.products.length,1);
});
test('invalid parameters fail without affecting subsequent catalogue or recommendation requests',async()=>{
 for(const query of ['budget=-1','budget=NaN','limit=51','limit=1.5','limit=invalid'])await assert.rejects(call('/api/recommendations?'+query),e=>e.status===400);
 assert.equal((await call('/api/products')).status,200);
 assert.equal((await call('/api/recommendations')).status,200);
});
test('database outage affects recommendations and readiness; recovery works without self HTTP probes',async()=>{
 const db=database();let fail=false;
 db.command=async()=>{if(fail)throw Error('private details');};
 const original=db.collection;db.collection=()=>{if(fail)throw Error('private details');return original();};
 for(const down of [false,true,false]){
  fail=down;
  for(const path of ['/ready','/api/recommendations']){
   if(down)await assert.rejects(call(path,db),e=>e.status===503&&!e.message.includes('private details'));
   else assert.equal((await call(path,db)).status,200);
  }
 }
});
