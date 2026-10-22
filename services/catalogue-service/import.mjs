import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { normalizeProducts } from './lib/catalogue.mjs';

const [source, destination = fileURLToPath(new URL('./products.json', import.meta.url))] = process.argv.slice(2);
if (!source) {
  console.error('Usage: npm run ingest -- products.json [output.json]. Restart catalogue-service after importing.');
  process.exit(1);
}
const products = normalizeProducts(JSON.parse(readFileSync(resolve(source), 'utf8')));
const target = resolve(destination);
writeFileSync(`${target}.tmp`, `${JSON.stringify(products, null, 2)}\n`);
renameSync(`${target}.tmp`, target);
console.log(`Imported ${products.length} validated products into ${target}.`);
