import { isIP } from 'node:net';

// Enable only when the gateway is private and all browser traffic passes through
// our NGINX, which overwrites X-Real-IP. Direct npm development leaves this off.
export function clientAddress(req, trustProxy = process.env.TRUST_PROXY === 'true') {
  const forwarded = req.headers['x-real-ip'];
  return trustProxy && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
}
