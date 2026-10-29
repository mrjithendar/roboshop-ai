import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeCatalogue } from '../bootstrap.mjs';
import { catalogueRoutes } from '../routes.mjs';

const product = sku => ({sku,name:sku,description:'Test item',price:199,currency:'INR',instock:25,categories:['robots']});
async function fixture(t, source) {
 const dir=await mkdtemp(join(tmpdir(),'catalogue-seed-'));
 const file=join(dir,'products.json'); await writeFile(file,JSON.stringify(source));
 const previous=process.env.CATALOGUE_FILE; process.env.CATALOGUE_FILE=file;
 t.after(async()=>{if(previous===undefined)delete process.env.CATALOGUE_FILE;else process.env.CATALOGUE_FILE=previous;await rm(dir,{recursive:true});});
 const rows=new Map(); let closed=0,writes=0;
 const collection={
  async createIndex(keys,options){assert.deepEqual(keys,{slug:1});assert.equal(options.unique,true);},
  async bulkWrite(operations){writes++;for(const {updateOne:o} of operations){assert.deepEqual(Object.keys(o.update),['$setOnInsert']);assert.equal(o.upsert,true);if(!rows.has(o.filter._id))rows.set(o.filter._id,{_id:o.filter._id,...structuredClone(o.update.$setOnInsert)});}},
  find(){return {sort(){return this;},limit(){return this;},async toArray(){return [...rows.values()];}}}
 };
 const connection={db:{collection(name){assert.equal(name,'products');return collection;},async command(){}},client:{async close(){closed++;}}};
 return {rows,collection,connection,file,get closed(){return closed;},get writes(){return writes;}};
}
test('startup publishes once, preserves edits and serves active Mongo products',async t=>{
 const f=await fixture(t,[product('A'),product('B')]);
 await initializeCatalogue(async()=>f.connection);
 Object.assign(f.rows.get('A'),{name:'Merchant edit',price:399,currency:'USD',instock:7,archived:true,revision:9});
 const saved=structuredClone(f.rows.get('A'));
 f.rows.set('MERCHANT',{...product('MERCHANT'),_id:'MERCHANT',revision:4});
 await initializeCatalogue(async()=>f.connection);
 assert.equal(f.rows.size,3);assert.deepEqual(f.rows.get('A'),saved);assert.equal(f.closed,0);
 const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
 await catalogueRoutes(f.connection.db)({method:'GET'},res,new URL('http://catalogue/api/products'));
 assert.deepEqual(res.body.products.map(p=>p.sku),['B','MERCHANT']);assert.equal(res.body.checkoutCurrency,'INR');
});
test('invalid later row prevents the entire batch from being written',async t=>{
 const f=await fixture(t,[product('A'),{...product('B'),price:-1}]);
 await assert.rejects(initializeCatalogue(async()=>f.connection),/Invalid price/);
 assert.equal(f.rows.size,0);assert.equal(f.writes,0);assert.equal(f.closed,1);
});
test('publication failure closes Mongo and prevents startup completion',async t=>{
 const f=await fixture(t,[product('A')]); f.collection.bulkWrite=async()=>{throw Error('Database unavailable');};
 await assert.rejects(initializeCatalogue(async()=>f.connection),/Database unavailable/);
 assert.equal(f.closed,1);
});
test('without CATALOGUE_FILE startup only ensures the index and writes no products',async t=>{
 const f=await fixture(t,[product('A')]); delete process.env.CATALOGUE_FILE;
 let indexes=0; f.collection.createIndex=async()=>{indexes++;};
 await initializeCatalogue(async()=>f.connection);
 assert.equal(indexes,1);assert.equal(f.writes,0);assert.equal(f.rows.size,0);assert.equal(f.closed,0);
});
