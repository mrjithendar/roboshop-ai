import { MongoClient } from 'mongodb';

export async function connectMongo(uri = process.env.MONGODB_URL, database = process.env.MONGODB_DATABASE || 'robotshop') {
  if (!uri) throw new Error('MONGODB_URL is required. Configure MongoDB before starting RobotShop.');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(database)) throw new Error('Invalid MONGODB_DATABASE');
  const client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 });
  try { await client.connect(); return { client, db: client.db(database) }; }
  catch { await client.close(); throw new Error('MongoDB is unavailable. Check its connection configuration.'); }
}
