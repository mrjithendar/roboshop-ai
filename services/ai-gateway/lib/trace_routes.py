"""Bounded route vocabulary from application handlers; never use raw unknown paths."""
import re
from urllib.parse import urlsplit
STATIC = frozenset(['/api/account/activity', '/api/account/addresses', '/api/account/photo', '/api/account/profile', '/api/account/purchases', '/api/admin/llm', '/api/admin/reviews', '/api/admin/test-orders', '/api/admin/users', '/api/auth/challenge', '/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/auth/mfa', '/api/auth/mfa/confirm', '/api/auth/mfa/disable', '/api/auth/mfa/enroll', '/api/auth/mfa/verify', '/api/auth/password/request', '/api/auth/password/reset', '/api/auth/register', '/api/cart', '/api/catalogue/categories', '/api/catalogue/ready', '/api/chat', '/api/chat/history', '/api/compare', '/api/currency/convert', '/api/currency/rates', '/api/ops', '/api/orders', '/api/payment/config', '/api/payment/lookup', '/api/payment/orders', '/api/payment/reconcile', '/api/payment/recover', '/api/payment/verify', '/api/payment/webhook-check', '/api/payments/config', '/api/payments/current', '/api/payments/orders', '/api/payments/quote', '/api/payments/status', '/api/payments/verify', '/api/payments/webhook', '/api/products', '/api/ready', '/api/recommendations', '/api/recommendations/personalized', '/api/settings', '/api/shipping/cities', '/api/shipping/countries', '/api/shipping/quote', '/api/shipping/ready', '/api/status', '/api/users/ready', '/available', '/categories', '/chat', '/convert', '/health', '/health/live', '/health/ready', '/history', '/internal/address', '/internal/chat', '/internal/limit', '/internal/llm/config', '/internal/llm/readiness', '/internal/llm/test', '/internal/purchase', '/internal/request', '/internal/session', '/internal/verified-purchase', '/mcp', '/metrics', '/products', '/rates', '/ready', '/widget.js'])
PATTERNS = [('/api/products/[^/]+/reviews/mine', '/api/products/{product_id}/reviews/mine'), ('/api/products/[^/]+/reviews', '/api/products/{product_id}/reviews'), ('/api/products/[^/]+', '/api/products/{product_id}'), ('/api/admin/reviews/[^/]+', '/api/admin/reviews/{review_id}'), ('/api/admin/test-orders/[^/]+/reconcile', '/api/admin/test-orders/{order_id}/reconcile'), ('/api/admin/users/[^/]+/(profile|purchases|activity)', '/api/admin/users/{user_id}/{section}'), ('/api/admin/users/[^/]+', '/api/admin/users/{user_id}'), ('/api/admin/products/[^/]+', '/api/admin/products/{product_id}'), ('/api/account/addresses/[^/]+', '/api/account/addresses/{address_id}'), ('/internal/carts/[^/]+/clear-checked', '/internal/carts/{cart_id}/clear-checked'), ('/internal/carts/[^/]+/clear', '/internal/carts/{cart_id}/clear'), ('/internal/carts/[^/]+', '/internal/carts/{cart_id}'), ('/api/catalogue/product/[^/]+', '/api/catalogue/product/{product_id}'), ('/api/catalogue/category/[^/]+', '/api/catalogue/category/{category}'), ('/api/catalogue/search/[^/]+', '/api/catalogue/search/{query}'), ('/product/[^/]+', '/product/{product_id}'), ('/products/[^/]+', '/products/{category}'), ('/search/[^/]+', '/search/{query}')]

STATIC = STATIC | frozenset('/api/shipping/countries /api/shipping/cities /internal/llm/readiness'.split())
STATIC |= frozenset(['/api/admin/products', '/api/admin/settings', '/api/admin/llm/status', '/api/admin/llm/test', '/api/admin/llm/disconnect', '/admin', '/account', '/account/', '/cart', '/cart/', '/checkout', '/checkout/', '/', '/index.html', '/admin.html', '/product.html', '/checkout.html', '/profile.html', '/profile.js', '/checkout.js', '/product.js', '/paths.js', '/challenge.js', '/app.js', '/account.js', '/admin.js', '/styles.css', '/mcp/'])
PATTERNS.extend([('/product-media/[a-z0-9-]+\\.(?:jpg|png)', '/product-media/{image}'), ('/illustrations/(robot|kit|component|accessory)\\.svg', '/illustrations/{type}.svg'), ('/images/[a-zA-Z0-9_-]+\\.png', '/images/{image}.png')])
STATIC |= frozenset(['/api/admin/product-images', '/api/admin/overview', '/api/admin/orders', '/api/admin/audit', '/fonts/inter-latin.woff2', '/fonts/inter-latin-ext.woff2'])
PATTERNS.append(('/api/product-images/[0-9a-f]{32}\\.jpg', '/api/product-images/{image}.jpg'))
def route_template(path):
    path = urlsplit(path).path
    prefix = ''
    if path.startswith('/roboshop/'):
        prefix, path = '/roboshop', path[len('/roboshop'):]
    if path in STATIC: return prefix + path
    for pattern, template in PATTERNS:
        if re.fullmatch(pattern, path): return prefix + template
    return ''

def quiet_route(route):
    if route.startswith('/roboshop/'): route = route[len('/roboshop'):]
    return route in ('/health','/health/live','/health/ready','/ready','/metrics','/available','/widget.js') or route.endswith('/ready')

def http_name(method, path):
    method = method if method in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS') else 'HTTP'
    return (method + ' ' + route_template(path)).rstrip()
