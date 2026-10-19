import { HttpError } from './runtime.mjs';

export function normalizeProducts(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10000) throw new Error('Catalogue must contain 1–10000 products.');
  const seen = new Set();
  return rows.map(p => {
    if (!p || typeof p.sku !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.sku) || ['__proto__', 'constructor', 'prototype'].includes(p.sku) || seen.has(p.sku)) throw new Error('Invalid or duplicate SKU.');
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 200 || typeof p.description !== 'string' || p.description.length > 3000) throw new Error(`Invalid text for ${p.sku}.`);
    if (!Number.isFinite(p.price) || p.price < 0 || p.price > 1000000 || !Number.isInteger(p.instock) || p.instock < 0) throw new Error(`Invalid price or stock for ${p.sku}.`);
    if (!Array.isArray(p.categories) || !p.categories.length || p.categories.some(c => typeof c !== 'string' || c.length > 100)) throw new Error(`Invalid categories for ${p.sku}.`);
    seen.add(p.sku);
    const details = productDetails(p);
    return { ...details, archived: p.archived === true, sku: p.sku, name: p.name.trim(), description: p.description, price: Math.round(p.price * 100) / 100, instock: p.archived === true ? 0 : p.instock, categories: p.categories, image: /^\/product-media\/[a-z0-9-]+\.jpg$/.test(p.image || "") ? p.image : p.showcase ? "/images/placeholder.png" : `/images/${p.sku}.png` };
  });
}
const stopwords = new Set('a an the for to me i want need find show robot robots droid please something under below less than euros euro with and of my is can you recommend'.split(' '));
export function tokens(query) { return query.toLowerCase().match(/[a-z0-9]+/g)?.filter(t => !stopwords.has(t) && !/^\d+$/.test(t)) || []; }
export function budgetFrom(query) {
  const match = query.match(/(?:under|below|less than|up to|max(?:imum)?|budget(?: of)?)\s*[€$₹]?\s*([\d,]+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1].replaceAll(',', '')) : undefined;
}
export function rank(products, { query = '', budget, category, exclude = [], limit = 4, inStock = true } = {}) {
  if (typeof query !== 'string' || query.length > 1000) throw new HttpError(400, 'Invalid search query.');
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new HttpError(400, 'Budget must be a nonnegative number.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, 'Limit must be between 1 and 50.');
  const currency = /\$|\bUSD\b/i.test(query) ? 'USD' : /₹|\bINR\b/i.test(query) ? 'INR' : 'EUR';
  const words = tokens(query);
  const synonyms = { guard: ['security', 'protection'], guarding: ['security', 'protection'], protect: ['security', 'protection'], safety: ['security', 'protection'], medical: ['medical', 'surgery'], doctor: ['medical', 'surgery'], gardening: ['vegetation', 'harvester'], mining: ['mining', 'minerals'], monitoring: ['observability'], cheap: [], affordable: [] };
  const terms = words.flatMap(w => [w, ...(synonyms[w] || [])]);
  const onlyBudget = words.every(w => ['cheap', 'affordable', 'budget'].includes(w));
  return products.filter(p => !p.archived && (!inStock || p.instock > 0) && (budget === undefined || (p.currency || 'EUR') === currency && p.priceType !== 'on-request' && p.price <= budget) && (!category || p.categories.includes(category)) && !exclude.includes(p.sku))
    .map(p => {
      const haystack = `${p.name} ${p.description} ${p.categories.join(' ')}`.toLowerCase();
      const matches = terms.filter(t => haystack.includes(t));
      return { ...p, score: matches.length, reason: matches.length ? `Matches ${[...new Set(matches)].slice(0, 3).join(', ')} in the catalogue.` : budget !== undefined ? `Catalogue reference within your ${currency} ${budget} budget.` : p.showcase ? 'Showcase catalogue pick; availability is simulated.' : 'In-stock catalogue pick.' };
    })
    .filter(p => !terms.length || onlyBudget || p.score > 0)
    .sort((a, b) => b.score - a.score || (a.currency || 'EUR').localeCompare(b.currency || 'EUR') || Number(a.priceType === 'on-request') - Number(b.priceType === 'on-request') || a.price - b.price || a.sku.localeCompare(b.sku)).slice(0, limit);
}

// Source metadata is data, never markup. Live prices remain EUR-only.
export function productDetails(p) {
  const result = { slug: p.slug || p.sku.toLowerCase().replaceAll('_', '-'), currency: p.currency || 'EUR', priceType: p.priceType || 'sale', showcase: p.showcase === true, fulfilment: p.showcase ? 'simulated' : 'merchant', synthetic: p.synthetic === true };
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(result.slug) || !/^[A-Z]{3}$/.test(result.currency) || !['sale', 'reference', 'on-request', 'illustrative'].includes(result.priceType)) throw new Error('Invalid slug, currency or price type.');
  for (const k of ['manufacturer', 'model', 'productType', 'packageNote', 'priceCheckedAt', 'checkedAt', 'catalogueVersion']) {
    if (p[k] !== undefined) { if (typeof p[k] !== 'string' || p[k].length > 1000 || /[<>]/.test(p[k])) throw new Error('Invalid product metadata.'); result[k] = p[k]; }
  }
  for (const k of ['includedItems', 'requiredAccessories', 'compatibility', 'useCases']) {
    if (p[k] !== undefined) { if (!Array.isArray(p[k]) || p[k].length > 30 || p[k].some(v => typeof v !== 'string' || v.length > 500 || /[<>]/.test(v))) throw new Error('Invalid product list.'); result[k] = p[k]; }
  }
  for (const k of ['specifications', 'imageAttribution']) {
    if (p[k] !== undefined) { if (!p[k] || Array.isArray(p[k]) || typeof p[k] !== 'object' || Object.keys(p[k]).length > 40 || Object.entries(p[k]).some(([key,v]) => /[<>]/.test(key) || key.length > 100 || typeof v !== 'string' || v.length > 1000 || /[<>]/.test(v))) throw new Error('Invalid product specifications.'); result[k] = p[k]; }
  }
  function safeUrl(value) { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Sources must be public HTTPS URLs.'); return value; }
  if (p.priceSourceUrl) result.priceSourceUrl = safeUrl(p.priceSourceUrl);
  if (p.sources) { if (!Array.isArray(p.sources) || p.sources.length > 10) throw new Error('Invalid sources.'); result.sources = p.sources.map(v => ({ label: String(v.label).slice(0, 100), url: safeUrl(v.url) })); }
  return result;
}
