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
    return { sku: p.sku, name: p.name.trim(), description: p.description, price: Math.round(p.price * 100) / 100, instock: p.instock, categories: p.categories, image: `/images/${p.sku}.png` };
  });
}
const stopwords = new Set('a an the for to me i want need find show robot robots droid please something under below less than euros euro with and of my is can you recommend'.split(' '));
export function tokens(query) { return query.toLowerCase().match(/[a-z0-9]+/g)?.filter(t => !stopwords.has(t) && !/^\d+$/.test(t)) || []; }
export function budgetFrom(query) {
  const match = query.match(/(?:under|below|less than|up to|max(?:imum)?|budget(?: of)?)\s*[€$]?\s*([\d,]+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1].replaceAll(',', '')) : undefined;
}
export function rank(products, { query = '', budget, category, exclude = [], limit = 4, inStock = true } = {}) {
  if (typeof query !== 'string' || query.length > 1000) throw new HttpError(400, 'Invalid search query.');
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new HttpError(400, 'Budget must be a nonnegative number.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, 'Limit must be between 1 and 50.');
  const words = tokens(query);
  const synonyms = { guard: ['security', 'protection'], guarding: ['security', 'protection'], protect: ['security', 'protection'], safety: ['security', 'protection'], medical: ['medical', 'surgery'], doctor: ['medical', 'surgery'], gardening: ['vegetation', 'harvester'], mining: ['mining', 'minerals'], monitoring: ['observability'], cheap: [], affordable: [] };
  const terms = words.flatMap(w => [w, ...(synonyms[w] || [])]);
  const onlyBudget = words.every(w => ['cheap', 'affordable', 'budget'].includes(w));
  return products.filter(p => (!inStock || p.instock > 0) && (budget === undefined || p.price <= budget) && (!category || p.categories.includes(category)) && !exclude.includes(p.sku))
    .map(p => {
      const haystack = `${p.name} ${p.description} ${p.categories.join(' ')}`.toLowerCase();
      const matches = terms.filter(t => haystack.includes(t));
      return { ...p, score: matches.length, reason: matches.length ? `Matches ${[...new Set(matches)].slice(0, 3).join(', ')} in the catalogue.` : budget !== undefined ? `In stock and within your €${budget} budget.` : 'In-stock catalogue pick.' };
    })
    .filter(p => !terms.length || onlyBudget || p.score > 0)
    .sort((a, b) => b.score - a.score || a.price - b.price || a.sku.localeCompare(b.sku)).slice(0, limit);
}
