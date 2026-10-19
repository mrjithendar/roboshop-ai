import { serve } from '../shared/runtime.mjs';
import { connectMongo } from '../shared/mongo.mjs';
import { catalogueRoutes } from './routes.mjs';
const { db, client } = await connectMongo();
const server = serve('catalogue-service', 4108, catalogueRoutes(db));
server.on('close', () => { void client.close(); });
