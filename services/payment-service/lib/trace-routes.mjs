const staticRoutes = new Set(["/api/account/activity", "/api/account/addresses", "/api/account/photo", "/api/account/profile", "/api/account/purchases", "/api/admin/llm", "/api/admin/reviews", "/api/admin/test-orders", "/api/admin/users", "/api/auth/challenge", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/auth/mfa", "/api/auth/mfa/confirm", "/api/auth/mfa/disable", "/api/auth/mfa/enroll", "/api/auth/mfa/verify", "/api/auth/password/request", "/api/auth/password/reset", "/api/auth/register", "/api/cart", "/api/catalogue/categories", "/api/catalogue/ready", "/api/chat", "/api/chat/history", "/api/compare", "/api/currency/convert", "/api/currency/rates", "/api/ops", "/api/orders", "/api/payment/config", "/api/payment/lookup", "/api/payment/orders", "/api/payment/reconcile", "/api/payment/recover", "/api/payment/verify", "/api/payment/webhook-check", "/api/payments/config", "/api/payments/current", "/api/payments/orders", "/api/payments/quote", "/api/payments/status", "/api/payments/verify", "/api/payments/webhook", "/api/products", "/api/ready", "/api/recommendations", "/api/recommendations/personalized", "/api/settings", "/api/shipping/cities", "/api/shipping/countries", "/api/shipping/quote", "/api/shipping/ready", "/api/status", "/api/users/ready", "/available", "/categories", "/chat", "/convert", "/health", "/health/live", "/health/ready", "/history", "/internal/address", "/internal/chat", "/internal/limit", "/internal/llm/config", "/internal/llm/readiness", "/internal/llm/test", "/internal/purchase", "/internal/request", "/internal/session", "/internal/verified-purchase", "/mcp", "/metrics", "/products", "/rates", "/ready", "/widget.js"]);
const patterns = [["/api/products/[^/]+/reviews/mine", "/api/products/{product_id}/reviews/mine"], ["/api/products/[^/]+/reviews", "/api/products/{product_id}/reviews"], ["/api/products/[^/]+", "/api/products/{product_id}"], ["/api/admin/reviews/[^/]+", "/api/admin/reviews/{review_id}"], ["/api/admin/test-orders/[^/]+/reconcile", "/api/admin/test-orders/{order_id}/reconcile"], ["/api/admin/users/[^/]+/(profile|purchases|activity)", "/api/admin/users/{user_id}/{section}"], ["/api/admin/users/[^/]+", "/api/admin/users/{user_id}"], ["/api/admin/products/[^/]+", "/api/admin/products/{product_id}"], ["/api/account/addresses/[^/]+", "/api/account/addresses/{address_id}"], ["/internal/carts/[^/]+/clear-checked", "/internal/carts/{cart_id}/clear-checked"], ["/internal/carts/[^/]+/clear", "/internal/carts/{cart_id}/clear"], ["/internal/carts/[^/]+", "/internal/carts/{cart_id}"], ["/api/catalogue/product/[^/]+", "/api/catalogue/product/{product_id}"], ["/api/catalogue/category/[^/]+", "/api/catalogue/category/{category}"], ["/api/catalogue/search/[^/]+", "/api/catalogue/search/{query}"], ["/product/[^/]+", "/product/{product_id}"], ["/products/[^/]+", "/products/{category}"], ["/search/[^/]+", "/search/{query}"]];
for (const route of ['/api/shipping/countries','/api/shipping/cities','/internal/llm/readiness']) staticRoutes.add(route);
export function routeTemplate(path) {
  path = new URL(path, 'http://local').pathname;
  let prefix = '';
  if (path.startsWith('/roboshop/')) { prefix='/roboshop'; path=path.slice(9); }
  if (staticRoutes.has(path)) return prefix + path;
  for (const [pattern, template] of patterns) if (new RegExp('^'+pattern+'$').test(path)) return prefix + template;
  return '';
}
export const quietRoute = route => ['/health','/health/live','/health/ready','/ready','/metrics','/available','/widget.js'].includes(route) || route.endsWith('/ready');
export const httpName = (method, path) => `${['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method) ? method : 'HTTP'} ${routeTemplate(path)}`.trim();
export function traceState(value) {
  if (typeof value !== 'string' || value.length > 512) return '';
  const members=value.split(','); if (members.length>32) return '';
  const keys=new Set();
  for (const member of members) {
    const [key, val, extra]=member.trim().split('=');
    if (extra !== undefined || !/^[a-z0-9][a-z0-9_*/@.-]{0,255}$/.test(key) || !val || val.length>256 || /[^\x20-\x2b\x2d-\x3c\x3e-\x7e]/.test(val) || val.endsWith(' ') || keys.has(key)) return '';
    keys.add(key);
  }
  return members.map(m=>m.trim()).join(',');
}
