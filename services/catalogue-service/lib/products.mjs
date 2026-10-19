import { normalizeProducts } from './catalogue.mjs';
export async function readProducts(db) {
  const rows = await db.collection('products').find({}, { projection: { _id: 0, revision: 0 } }).sort({ sku: 1 }).limit(10000).toArray();
  return rows.length ? normalizeProducts(rows) : [];
}
export const defaultSettings = { storeName: 'RobotShop', announcement: 'THE NEXT GENERATION OF GOOD COMPANY.', supportEmail: '', checkoutEnabled: true };
export async function readSettings(db) { const doc = await db.collection('settings').findOne({ _id: 'public' }); return { ...defaultSettings, ...(doc?.value || {}) }; }
