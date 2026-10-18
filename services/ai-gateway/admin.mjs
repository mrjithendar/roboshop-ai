import { body, json, HttpError, text } from '../shared/runtime.mjs';
import { normalizeProducts } from '../shared/catalogue.mjs';
import { readSettings } from '../shared/products.mjs';
import { requireRole, publicUser, emailAddress } from './auth.mjs';
let tail = Promise.resolve();
export async function withCatalogueLock(work) {
  const previous = tail; let release;
  tail = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}
export async function adminRoutes(req, res, url, { db, auth, store }) {
  const actor = requireRole(req.user, ['admin', 'superadmin']);
  const products = db.collection('products');
  if (url.pathname === '/api/admin/products' && req.method === 'GET') {
    const rows = await products.find().sort({ sku: 1 }).limit(10000).toArray();
    return json(res, { products: rows.map(({ _id, ...p }) => ({ ...p, available: store.available(p) })) });
  }
  const match = /^\/api\/admin\/products\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
  if ((url.pathname === '/api/admin/products' && req.method === 'POST') || (match && req.method === 'PUT')) {
    const data = await body(req);
    if (Object.keys(data).some(key => !['sku', 'name', 'description', 'price', 'instock', 'categories', 'archived', 'revision'].includes(key))) throw new HttpError(400, 'Unknown product field.');
    if (data.archived !== undefined && typeof data.archived !== 'boolean') throw new HttpError(400, 'Archived must be true or false.');
    let product;
    try { [product] = normalizeProducts([data]); } catch { throw new HttpError(400, 'Enter a valid SKU, name, description, price, stock and categories.'); }
    if (match && (match[1] !== product.sku || !Number.isInteger(data.revision))) throw new HttpError(400, 'SKU cannot change and a revision is required.');
    return withCatalogueLock(async () => {
      if (match) {
        const reserved = store.state.orders.filter(order => ['creating', 'payment_pending', 'payment_review'].includes(order.status)).reduce((sum, order) => sum + (order.items.find(item => item.sku === product.sku)?.quantity || 0), 0);
        if ((product.archived && reserved > 0) || (!product.archived && product.instock < reserved + (store.state.sold[product.sku] || 0))) throw new HttpError(409, 'Stock cannot fall below sold and reserved quantities; pending orders prevent archiving.');
        const result = await products.updateOne({ _id: product.sku, revision: data.revision }, { $set: { ...product, updatedAt: new Date(), updatedBy: actor.id }, $inc: { revision: 1 } });
        if (!result.matchedCount) throw new HttpError(409, 'Product changed or does not exist. Refresh before editing.');
      } else {
        if (await products.countDocuments() >= 10000) throw new HttpError(409, 'Catalogue capacity reached.');
        try { await products.insertOne({ _id: product.sku, ...product, revision: 1, updatedAt: new Date(), updatedBy: actor.id }); }
        catch (error) { if (error.code === 11000) throw new HttpError(409, 'SKU already exists.'); throw error; }
      }
      return json(res, { saved: true }, match ? 200 : 201);
    });
  }
  requireRole(actor, ['superadmin']);
  if (url.pathname === '/api/admin/users' && req.method === 'GET') {
    const after = url.searchParams.get('after') || '';
    if (after.length > 100) throw new HttpError(400, 'Invalid cursor.');
    const users = await auth.users.find(after ? { _id: { $gt: after } } : {}, { projection: { passwordHash: 0 } }).sort({ _id: 1 }).limit(101).toArray();
    return json(res, { users: users.slice(0, 100).map(publicUser), next: users.length > 100 ? users[99]._id : null });
  }
  const user = /^\/api\/admin\/users\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (user && req.method === 'PATCH') return json(res, { user: await auth.changeUser(actor, user[1], await body(req)) });
  if (url.pathname === '/api/admin/settings') {
    if (req.method === 'GET') return json(res, await readSettings(db));
    if (req.method === 'PUT') {
      const data = await body(req);
      if (Object.keys(data).some(key => !['storeName', 'announcement', 'supportEmail', 'checkoutEnabled'].includes(key)) || typeof data.checkoutEnabled !== 'boolean') throw new HttpError(400, 'Only public store settings can be changed here.');
      const value = { storeName: text(data.storeName, 'Store name', 60), announcement: text(data.announcement, 'Announcement', 160), supportEmail: data.supportEmail === '' ? '' : emailAddress(data.supportEmail), checkoutEnabled: data.checkoutEnabled };
      await db.collection('settings').updateOne({ _id: 'public' }, { $set: { value, updatedAt: new Date(), updatedBy: actor.id } }, { upsert: true });
      return json(res, value);
    }
  }
  throw new HttpError(404, 'Admin endpoint not found.');
}
