import { connectMongo } from '../services/shared/mongo.mjs';
import { Auth } from '../services/ai-gateway/auth.mjs';
let client;
try {
  const connection = await connectMongo(); client = connection.client;
  const auth = new Auth(connection.db); await auth.initialize();
  await auth.bootstrap({ email: process.env.SUPERADMIN_EMAIL, password: process.env.SUPERADMIN_PASSWORD, name: process.env.SUPERADMIN_NAME });
  console.log('The single super admin account was created. Remove SUPERADMIN_PASSWORD from your environment after setup.');
} catch (error) { console.error(error.status ? error.message : 'Super admin setup failed. Check MongoDB and setup configuration.'); process.exitCode = 1; }
finally { await client?.close(); }
