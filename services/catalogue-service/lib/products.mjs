import { readFile } from 'node:fs/promises';
import { normalizeProducts } from './catalogue.mjs';
// Catalogue data lives in MongoDB (imported by services/mongodb/catalog.js); this
// service only reads it. The slug index is schema, not data, so startup ensures it.
export async function ensureCatalogueIndexes(db) {
  await db.collection('products').createIndex({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });
}
// Explicit fixture import (tests, local experiments, `npm run ingest`); never a bundled default.
export async function seedProducts(db, file = process.env.CATALOGUE_FILE) {
  if (!file) throw new Error('Name the products file to import; the catalogue itself is stored in MongoDB.');
  const products = normalizeProducts(JSON.parse(await readFile(file, 'utf8')));
  await ensureCatalogueIndexes(db);
  // Insert-only upserts preserve administrator edits, including archived products.
  const result = await db.collection('products').bulkWrite(products.map(product => ({ updateOne: { filter: { _id: product.sku }, update: { $setOnInsert: { ...product, revision: 1 } }, upsert: true } })));
  return { inserted: result?.upsertedCount ?? 0, total: products.length };
}
export async function readProducts(db) {
  const rows = await db.collection('products').find({}, { projection: { _id: 0, revision: 0 } }).sort({ sku: 1 }).limit(10000).toArray();
  // Keep historical records in MongoDB, but retire informational listings from all consumers.
  return rows.length ? normalizeProducts(rows).filter(p => !p.showcase && !['reference', 'legacy-reference'].includes(p.collection) && !p.sku.startsWith('REF-')) : [];
}
export const defaultSettings = { storeName: 'RoboShop', announcement: 'THE NEXT GENERATION OF GOOD COMPANY.', supportEmail: '', checkoutEnabled: true };
export async function readSettings(db) { const doc = await db.collection('settings').findOne({ _id: 'public' }); return { ...defaultSettings, ...(doc?.value || {}) }; }
