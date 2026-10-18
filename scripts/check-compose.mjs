// Usage: docker compose config --format json | node scripts/check-compose.mjs
// Inspect the resolved model without starting containers or printing credentials.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const model = JSON.parse(input);
for (const [name, service] of Object.entries(model.services)) {
  if (service.build) {
    const { context, dockerfile = 'Dockerfile' } = service.build;
    if (!existsSync(resolve(context, dockerfile))) throw new Error(`${name}: Dockerfile does not exist in resolved build context`);
  }
  for (const mount of service.volumes || []) {
    if (mount.type === 'bind' && !existsSync(mount.source)) throw new Error(`${name}: bind-mount source does not exist`);
  }
}
if (model.services['ai-gateway'].ports?.length) throw new Error('Gateway must remain private behind NGINX');
for (const service of ['nginx', 'redis', 'rabbitmq', 'shipping-db']) {
  if (!model.services[service]) throw new Error(`Missing supporting service: ${service}`);
}
console.log('Compose service definitions, build paths, mounts and gateway boundary validated.');
