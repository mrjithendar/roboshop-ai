import test from 'node:test';
import assert from 'node:assert/strict';
import {repriceCatalogue} from '../lib/price-migration.mjs';
test('INR migration preserves inventory and admin edits on subsequent publication',async()=>{
 const row={_id:'A',sku:'A',price:499,currency:'USD',instock:23,revision:4};
 const collection={find:()=>({toArray:async()=>row.priceVersion?[]:[{...row}]}),updateOne:async(filter,update)=>{assert.equal(filter.revision,row.revision);assert.equal(update.$set.instock,undefined);Object.assign(row,update.$set);row.revision++;return{matchedCount:1,modifiedCount:1}}};
 const db={collection:name=>{assert.equal(name,'products');return collection}};
 assert.equal(await repriceCatalogue(db,[{sku:'A',price:999}]),1);
 assert.equal(row.currency,'INR');assert.equal(row.price,999);assert.equal(row.instock,23);assert.equal(row.revision,5);
 row.price=799;
 assert.equal(await repriceCatalogue(db,[{sku:'A',price:999}]),0);assert.equal(row.price,799);
});
