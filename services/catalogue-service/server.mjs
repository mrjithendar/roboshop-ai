import { serve, logEvent } from './lib/runtime.mjs';
import { initializeCatalogue } from './bootstrap.mjs';
import { catalogueRoutes } from './routes.mjs';
const { db, client } = await initializeCatalogue();
const count = await db.collection('products').countDocuments({}, { limit: 1 });
// An empty catalogue is valid (fresh database not yet imported); say how to fix it.
logEvent('catalogue_ready', count ? {outcome:'success'} : {outcome:'empty', reason:'run_services_mongodb_catalog_js'});
const server = serve('catalogue-service', 4108, catalogueRoutes(db));
server.on('close', () => { void client.close(); });
