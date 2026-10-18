import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeProducts } from '../shared/catalogue.mjs';

const [source, destination = 'services/product-ingestion/products.json'] = process.argv.slice(2);
if (!source) {
  console.error('Usage: npm run ingest -- products.json [output.json]. Restart product-ingestion after importing.');
  process.exit(1);
}
const products = normalizeProducts(JSON.parse(readFileSync(resolve(source), 'utf8')));
const target = resolve(destination);
writeFileSync(`${target}.tmp`, `${JSON.stringify(products, null, 2)}\n`);
renameSync(`${target}.tmp`, target);
console.log(`Imported ${products.length} validated products into ${target}.`);
