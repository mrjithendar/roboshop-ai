import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeProducts } from '../services/catalogue-service/lib/catalogue.mjs';
import { plan, configMap, CATALOG_FILE, CONFIGMAP_FILE } from '../scripts/data/import-catalog.mjs';

const source = readFileSync(CATALOG_FILE, 'utf8');
const ADDED = ['POOLPRO-P7', 'WINDOWGLIDE-W3', 'CODECUB-K1', 'STEMSTAR-S5', 'GRIPMATE-G2', 'HARVESTHAND-H6', 'PATROLPAW-Q4',
  'CARECOMPANION-E1', 'PALLETMOVER-M8', 'SKYSURVEY-D2', 'PIPECRAWL-I3', 'BREWBOT-B1'];

test('catalog.js holds 32 valid, unique products including the new robots', () => {
  const { products } = plan(source);
  const rows = normalizeProducts(products); // throws on invalid or duplicate rows
  assert.equal(rows.length, 32);
  assert.equal(new Set(rows.map(p => p.slug)).size, 32);
  for (const sku of ADDED) {
    const p = rows.find(row => row.sku === sku);
    assert.ok(p, sku);
    // New listings are honest demo rows: no invented photos or hardware specifications.
    assert.equal(p.demo, true); assert.equal(p.fulfilment, 'simulated'); assert.equal(p.priceType, 'sale'); assert.equal(p.currency, 'INR');
    assert.equal(p.image, '/images/placeholder.png'); assert.equal(p.productType, 'complete robot');
    assert.match(p.specifications['Specification status'], /pending supplier confirmation/);
    assert.ok(p.categories.includes('robot') && p.categories.length === 2);
  }
});

test('the script is insert-only, ensures the slug index and targets the configured database', () => {
  const { database, calls } = plan(source, { MONGODB_DATABASE: 'roboshop_test' });
  assert.equal(database, 'roboshop_test');
  assert.equal(plan(source).database, 'roboshop');
  assert.deepEqual(calls.map(c => [c.collection, c.method]), [['products', 'createIndex'], ['products', 'bulkWrite']]);
  assert.deepEqual(calls[0].args, [{ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } }]);
  for (const { updateOne } of calls[1].args[0]) {
    assert.deepEqual(Object.keys(updateOne.update), ['$setOnInsert']);
    assert.equal(updateOne.upsert, true); assert.equal(updateOne.filter._id, updateOne.update.$setOnInsert.sku);
    assert.equal(updateOne.update.$setOnInsert.revision, 1);
  }
});

test('Python tools can read the JSON data block', () => {
  const block = source.split('const CATALOG = ', 2)[1].split(';\n// END CATALOG DATA', 2)[0];
  assert.deepEqual(JSON.parse(block), plan(source).products);
});

// The ConfigMap and MongoDB manifests live in the tools repository (tools/roboshop/minikube/mongodb);
// its own tests check the mounts. Here: the generated copy must match, when that checkout is present.
test('tools ConfigMap copy matches catalog.js', { skip: existsSync(CONFIGMAP_FILE) ? false : 'tools checkout not found beside roboshop-ai (set TOOLS_DIR)' }, () => {
  assert.equal(readFileSync(CONFIGMAP_FILE, 'utf8'), configMap(source), 'run npm run catalog:configmap');
});

test('catalogue data is no longer bundled in service code', () => {
  for (const file of ['products.json', 'publish-catalogue.mjs', 'refresh-showcase.mjs']) assert.equal(existsSync(`services/catalogue-service/${file}`), false, file);
  const products = readFileSync('services/catalogue-service/lib/products.mjs', 'utf8');
  assert.doesNotMatch(products, /products\.json/);
});
