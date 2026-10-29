#!/usr/bin/env node
// Runs services/mongodb/catalog.js (the mongosh catalogue script) with the Node MongoDB
// driver, for local development and environments without mongosh.
//
//   npm run catalog:import            # insert missing products into MONGODB_URL / MONGODB_DATABASE
//   npm run catalog:configmap         # refresh the ConfigMap copy in the tools repo (../tools or TOOLS_DIR)
//
// The script is executed against a recording shim first, so exactly the same calls run
// here as under mongosh, and every product is validated before anything is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MongoClient } from 'mongodb';
import { normalizeProducts } from '../../services/catalogue-service/lib/catalogue.mjs';

const ROOT = new URL('../../', import.meta.url);
export const CATALOG_FILE = fileURLToPath(new URL('services/mongodb/catalog.js', ROOT));
// Cluster configuration lives in the tools repository (expected beside this checkout).
const TOOLS_DIR = process.env.TOOLS_DIR || fileURLToPath(new URL('../tools/', ROOT));
export const CONFIGMAP_FILE = `${TOOLS_DIR.replace(/\/$/, '')}/roboshop/minikube/mongodb/mongodb-catalog-configmap.yaml`;

/** The operations catalog.js performs, without touching a database. */
export function plan(source = readFileSync(CATALOG_FILE, 'utf8'), env = {}) {
  const calls = [];
  let database;
  const collection = name => ({
    createIndex: (...args) => { calls.push({ collection: name, method: 'createIndex', args }); return 'slug_1'; },
    bulkWrite: (...args) => { calls.push({ collection: name, method: 'bulkWrite', args }); return { upsertedCount: 0 }; },
  });
  const db = { getSiblingDB: name => { database = name; return { getCollection: collection }; } };
  vm.runInNewContext(source, { db, print: () => {}, process: { env } }, { filename: 'catalog.js', timeout: 5000 });
  // Plain JSON copies: objects created inside the sandbox belong to another realm.
  calls.splice(0, calls.length, ...JSON.parse(JSON.stringify(calls)));
  const writes = calls.filter(call => call.method === 'bulkWrite').flatMap(call => call.args[0]);
  const products = writes.map(({ updateOne }) => {
    const { revision, ...product } = updateOne.update.$setOnInsert;
    return product;
  });
  normalizeProducts(products); // Throws on invalid or duplicate products before any write.
  return { database, calls, products };
}

export async function importCatalog({ uri = process.env.MONGODB_URL, env = process.env } = {}) {
  if (!uri) throw new Error('MONGODB_URL is required.');
  const { database, calls, products } = plan(undefined, env);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(database)) throw new Error('Invalid MONGODB_DATABASE');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    let inserted = 0;
    for (const call of calls) {
      const result = await client.db(database).collection(call.collection)[call.method](...call.args);
      if (call.method === 'bulkWrite') inserted += result.upsertedCount;
    }
    return { database, inserted, total: products.length };
  } finally {
    await client.close();
  }
}

export function configMap(source = readFileSync(CATALOG_FILE, 'utf8')) {
  const body = source.replace(/\n$/, '').split('\n').map(line => (line ? '    ' + line : '')).join('\n');
  return `# Generated from services/mongodb/catalog.js by \`npm run catalog:configmap\`; do not edit.
# Mounted into MongoDB's /docker-entrypoint-initdb.d, so it runs on an empty volume only.
apiVersion: v1
kind: ConfigMap
metadata:
  name: mongodb-catalog
  namespace: roboshop-ai
  labels:
    app.kubernetes.io/part-of: roboshop-ai
data:
  20-catalog.js: |
${body}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/data/import-catalog.mjs [--configmap]. Without options, inserts missing catalogue products into MONGODB_URL.');
  } else if (process.argv.includes('--configmap')) {
    plan();
    writeFileSync(CONFIGMAP_FILE, configMap());
    console.log(`Wrote ${CONFIGMAP_FILE}.`);
  } else {
    const { database, inserted, total } = await importCatalog();
    console.log(`RoboShop catalog: ${inserted} of ${total} products inserted into ${database}; existing products unchanged.`);
  }
}
