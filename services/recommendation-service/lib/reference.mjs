// Reference rows are informational. Validation never converts them into sale offers.
export function validateReference(p) {
  const reference = p.collection === 'reference' || p.sku?.startsWith('REF-');
  if (!reference) return;
  if (p.collection !== 'reference' || !p.sku.startsWith('REF-') || p.showcase !== true || p.demo !== false || p.synthetic !== false || p.fulfilment !== 'simulated' || p.inventoryStatus !== 'simulated' || p.instock !== 0 || !['reference', 'on-request'].includes(p.priceType)) throw Error('Reference listings must be display-only with zero simulated inventory.');
  if (!['complete robot', 'kit', 'component', 'accessory'].includes(p.productType) || !p.manufacturer || !p.model || !['manufacturer', 'authorized-retailer'].includes(p.sourceKind)) throw Error('Reference identity and source kind are required.');
  for (const key of ['checkedAt', 'priceCheckedAt']) if (typeof p[key] !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(p[key]) || !Number.isFinite(Date.parse(p[key]))) throw Error('Reference check timestamps are required.');
  if (!p.sources?.length || !p.sources.some(s => s.url === p.priceSourceUrl) || !p.priceBasis || !p.specifications || !Object.keys(p.specifications).length || !Array.isArray(p.compatibility) || !Array.isArray(p.unresolvedFields)) throw Error('Reference evidence and unresolved fields are required.');
  if (p.priceType === 'reference' ? !(p.price > 0) : p.price !== 0) throw Error('Unknown prices use on-request with a non-payable zero sentinel.');
  if (p.image !== '/images/placeholder.png' || !p.imageAttribution?.credit) throw Error('This import uses labeled category illustrations only; image permissions need separate review.');
}
