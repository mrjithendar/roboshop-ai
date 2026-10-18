// Usage: docker compose config --format json | node scripts/check-compose.mjs
// Inspect the resolved model without starting containers or printing credentials.
import { existsSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const model = JSON.parse(input);
for (const [name, service] of Object.entries(model.services)) {
  if (service.build) throw new Error(`${name}: Compose must use prebuilt images, not build instructions`);
  for (const mount of service.volumes || []) {
    if (mount.type === 'bind' && !existsSync(mount.source)) throw new Error(`${name}: bind-mount source does not exist`);
  }
}
if (model.services['ai-gateway'].ports?.length) throw new Error('Gateway must remain private behind NGINX');
for (const service of ['nginx', 'redis', 'rabbitmq', 'shipping-db', 'mongodb']) {
  if (!model.services[service]) throw new Error(`Missing supporting service: ${service}`);
}
const applications = ['ai-gateway', 'product-ingestion', 'recommendation-service', 'shopping-agent', 'sre-copilot', 'payment-service', 'shipping-service', 'nginx', ...(model.services['mcp-server'] ? ['mcp-server'] : [])];
const images = new Set();
for (const name of applications) {
  const service = model.services[name];
  if (!service?.image) throw new Error(`${name}: expected a prebuilt image`);
  if (images.has(service.image)) throw new Error(`${name}: application images must be distinct`);
  images.add(service.image);
}
console.log('Compose prebuilt images, mounts and gateway boundary validated.');
