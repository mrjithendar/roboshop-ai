import test from 'node:test';
import assert from 'node:assert/strict';
import { Locations, distanceKm } from '../services/shipping-service/database.mjs';
test('distance calculation handles origin, antipodes and known route', () => {
  assert.equal(distanceKm(51.164896,7.068792),0);
  assert.equal(distanceKm(0,180,0,0),20015);
  assert.ok(Math.abs(distanceKm(40.7128,-74.006,51.5074,-0.1278)-5570)<5);
});
test('PostgreSQL seed, bounded search, input validation and authoritative quote', async () => {
  const locations = new Locations();
  try {
    await locations.ready();
    const countries = await locations.countries();
    assert.equal(countries.length,252);
    assert.equal(countries.reduce((n,c)=>n+c.cityCount,0),34167);
    const cities = await locations.search('IN','Hyderabad'); assert.ok(cities.length);
    assert.deepEqual(await locations.search('IN',"'; DROP TABLE shipping.cities;--"),[]);
    await assert.rejects(locations.search('XX','City'),/valid country/);
    await assert.rejects(locations.quote({cityId:-1}),/Select a city/);
    const destination={cityId:cities[0].id,recipient:'Test Customer',line1:'123 Test Street',postalCode:'500001',cost:0};
    const quote=await locations.quote(destination);
    assert.equal(quote.cost,quote.distanceKm*0.05); assert.ok(quote.cost>0);
    await assert.rejects(locations.quote({...destination,recipient:''}),/Recipient/);
    await assert.rejects(locations.quote({...destination,line1:'bad\naddress'}),/Invalid/);
  } finally { await locations.close(); }
});
