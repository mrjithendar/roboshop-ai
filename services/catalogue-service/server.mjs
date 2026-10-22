import { serve, logEvent } from './lib/runtime.mjs';
import { initializeCatalogue } from './bootstrap.mjs';
import { catalogueRoutes } from './routes.mjs';
const { db, client } = await initializeCatalogue();
logEvent('catalogue_seed_completed', {reason:'missing_products_seeded_existing_edits_preserved',outcome:'success'});
const server = serve('catalogue-service', 4108, catalogueRoutes(db));
server.on('close', () => { void client.close(); });
