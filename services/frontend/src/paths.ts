// Resolve the mount path from this module URL; works at / and /roboshop/.
export const basePath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
export function appPath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? basePath + path : path;
}

export function productImage(product: { image: string; productType?: string }): string {
  if (product.image && product.image !== '/images/placeholder.png') return appPath(product.image);
  const category = product.productType === 'complete robot' ? 'robot' : product.productType === 'kit' ? 'kit' : product.productType === 'accessory' ? 'accessory' : 'component';
  return appPath(`/illustrations/${category}.svg`);
}
export function canPurchase(product: { showcase?: boolean; synthetic?: boolean; currency?: string; priceType?: string }): boolean {
  return !product.showcase && !product.synthetic && (product.currency || 'EUR') === 'EUR' && (product.priceType || 'sale') === 'sale';
}
