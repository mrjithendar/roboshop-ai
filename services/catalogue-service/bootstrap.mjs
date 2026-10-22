import { connectMongo } from './lib/mongo.mjs';
import { seedProducts } from './lib/products.mjs';

// Do not accept catalogue traffic until the complete seed is validated/published.
// Publication is insert-only; migrations are separate, explicit operator commands.
export async function initializeCatalogue(connect = connectMongo) {
  const connection = await connect();
  try {
    await seedProducts(connection.db);
    return connection;
  } catch (error) {
    await connection.client.close();
    throw error;
  }
}
