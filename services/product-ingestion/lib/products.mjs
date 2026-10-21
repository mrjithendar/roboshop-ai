import { readFile } from 'node:fs/promises';
import { normalizeProducts } from './catalogue.mjs';
export async function seedProducts(db) {
  const configured = JSON.parse(await readFile(process.env.CATALOGUE_FILE || new URL('../products.json', import.meta.url), 'utf8'));
  const products = normalizeProducts(configured);
  await db.collection('products').createIndex({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });
  // Insert-only upserts preserve administrator edits, including archived products.
  await db.collection('products').bulkWrite(products.map(product => ({ updateOne: { filter: { _id: product.sku }, update: { $setOnInsert: { ...product, revision: 1 } }, upsert: true } })));
}
export async function readProducts(db) {
  const rows = await db.collection('products').find({}, { projection: { _id: 0, revision: 0 } }).sort({ sku: 1 }).limit(10000).toArray();
  // Keep historical records in MongoDB, but retire informational listings from all consumers.
  return rows.length ? normalizeProducts(rows).filter(p => !p.showcase && !['reference', 'legacy-reference'].includes(p.collection) && !p.sku.startsWith('REF-')) : [];
}
export const defaultSettings = { storeName: 'RobotShop', announcement: 'THE NEXT GENERATION OF GOOD COMPANY.', supportEmail: '', checkoutEnabled: true };
export async function readSettings(db) { const doc = await db.collection('settings').findOne({ _id: 'public' }); return { ...defaultSettings, ...(doc?.value || {}) }; }
