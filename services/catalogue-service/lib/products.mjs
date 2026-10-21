import { normalizeProducts } from './catalogue.mjs';
export async function readProducts(db) {
  const rows = await db.collection('products').find({}, { projection: { _id: 0, revision: 0 } }).sort({ sku: 1 }).limit(10000).toArray();
  // Keep historical records in MongoDB, but retire informational listings from all consumers.
  return rows.length ? normalizeProducts(rows).filter(p => !p.showcase && !['reference', 'legacy-reference'].includes(p.collection) && !p.sku.startsWith('REF-')) : [];
}
export const defaultSettings = { storeName: 'RoboShop', announcement: 'THE NEXT GENERATION OF GOOD COMPANY.', supportEmail: '', checkoutEnabled: true };
export async function readSettings(db) { const doc = await db.collection('settings').findOne({ _id: 'public' }); return { ...defaultSettings, ...(doc?.value || {}) }; }
