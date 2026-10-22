import {businessSpan,configureTelemetry} from './lib/runtime.mjs';
import { connectMongo } from './lib/mongo.mjs';
import { seedProducts } from './lib/products.mjs';
configureTelemetry('catalogue-service');

// Do not accept catalogue traffic until the complete seed is validated/published.
// Publication is insert-only; migrations are separate, explicit operator commands.
export async function initializeCatalogue(connect = connectMongo) {
  const connection = await connect();
  try {
    await businessSpan("catalogue.ingest", () => seedProducts(connection.db));
    return connection;
  } catch (error) {
    await connection.client.close();
    throw error;
  }
}
