import {businessSpan,configureTelemetry} from './lib/runtime.mjs';
// Additive, insert-only publication. Never archive, reprice or replenish existing rows.
import { connectMongo } from './lib/mongo.mjs';
import { seedProducts } from './lib/products.mjs';
configureTelemetry('catalogue-service');
const { client, db } = await connectMongo();
try {
  await businessSpan("catalogue.ingest", () => seedProducts(db));
  console.log('Missing configured sale/demo listings inserted. Existing products, admin edits, inventory and order currencies preserved.');
} finally { await client.close(); }
