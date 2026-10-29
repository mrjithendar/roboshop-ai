import {businessSpan,configureTelemetry} from './lib/runtime.mjs';
import { connectMongo } from './lib/mongo.mjs';
import { ensureCatalogueIndexes, seedProducts } from './lib/products.mjs';
configureTelemetry('catalogue-service');

// Products come from MongoDB, imported by services/mongodb/catalog.js when the database
// is set up. Startup writes no catalogue data, except an explicit CATALOGUE_FILE fixture.
export async function initializeCatalogue(connect = connectMongo) {
  const connection = await connect();
  try {
    await ensureCatalogueIndexes(connection.db);
    if (process.env.CATALOGUE_FILE) await businessSpan("catalogue.ingest", () => seedProducts(connection.db));
    return connection;
  } catch (error) {
    await connection.client.close();
    throw error;
  }
}
