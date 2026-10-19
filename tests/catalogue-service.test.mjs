import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueRoutes } from '../services/catalogue-service/routes.mjs';
const rows=[{sku:'A',name:'Atlas Robot',description:'Friendly humanoid',price:199,currency:'USD',instock:10,categories:['humanoid']},{sku:'B',name:'Rover',description:'Outdoor robot',price:299,currency:'USD',instock:0,categories:['rover']},{sku:'OLD',name:'Archived',description:'Old robot',price:10,instock:2,categories:['retired'],archived:true}];
function db(data=rows,fail=false) {
 return {command:async()=>{if(fail)throw Error('private connection detail');}, collection:()=>({find:()=>({sort(){return this;},limit(){return this;},async toArray(){if(fail)throw Error('private connection detail');return data;}})})};
}
async function call(path,database=db(),method='GET') {
 const response={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);this.writableEnded=true;}};
 await catalogueRoutes(database)({method},response,new URL(path,'http://catalogue'));
 return response;
}
test('legacy and modern lists exclude archived products and retain stock/currency',async()=>{
 const legacy=await call('/products');assert.deepEqual(legacy.body.map(p=>p.sku),['A','B']);assert.equal(legacy.body[1].instock,0);
 const modern=await call('/api/products');assert.equal(modern.body.checkoutCurrency,'USD');assert.equal(modern.body.products.length,2);
 assert.equal((await call('/api/products',db([]))).body.checkoutCurrency,null);
 assert.equal((await call('/api/products',db([rows[0],{...rows[1],currency:'EUR'}]))).body.checkoutCurrency,null);
});
test('SKU, categories and category aliases follow legacy contract',async()=>{
 assert.equal((await call('/product/A')).body.sku,'A');
 assert.equal((await call('/api/catalogue/product/A')).body.sku,'A');
 assert.deepEqual((await call('/categories')).body,['humanoid','rover']);
 assert.equal((await call('/products/rover')).body[0].sku,'B');
 await assert.rejects(call('/product/OLD'),e=>e.status===404);
});
test('search is literal, validated and has no regex or query injection',async()=>{
 assert.deepEqual((await call('/search/atlas%20robot')).body.map(p=>p.sku),['A']);
 assert.deepEqual((await call('/search/.*')).body,[]);
 await assert.rejects(call('/search/%ZZ'),e=>e.status===400);
 await assert.rejects(call('/search/%00'),e=>e.status===400);
 assert.equal((await call('/products',db(),'POST')).writableEnded,undefined);
});
test('Mongo readiness and read failures return safe 503 errors',async()=>{
 assert.equal((await call('/api/catalogue/ready')).body.status,'ok');
 for(const path of ['/api/catalogue/ready','/products'])await assert.rejects(call(path,db(rows,true)),e=>e.status===503&&!e.message.includes('private'));
});
