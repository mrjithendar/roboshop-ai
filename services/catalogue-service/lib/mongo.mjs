import { MongoClient } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { context, exportSpan } from './runtime.mjs';

export async function connectMongo(uri = process.env.MONGODB_URL, database = process.env.MONGODB_DATABASE || 'roboshop') {
  if (!uri) throw new Error('MONGODB_URL is required. Configure MongoDB before starting RoboShop.');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(database)) throw new Error('Invalid MONGODB_DATABASE');
  const client = new MongoClient(uri, { monitorCommands: true, maxPoolSize: 10, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 });
  const pending = new Map();
  client.on('commandStarted', event => {
    const parent = context.getStore();
    if (!parent || pending.size >= 64) return;
    pending.set(event.requestId, { start: Date.now(), name: event.commandName, ctx: { ...parent, spanId: randomBytes(8).toString('hex'), parentSpanId: parent.spanId, kind: 3 } });
  });
  function finish(event, status) {
    const entry = pending.get(event.requestId); if (!entry) return;
    pending.delete(event.requestId);
    exportSpan(entry.ctx.service, entry.ctx, entry.start, `mongodb ${entry.name}`, status, { 'db.system.name': 'mongodb', 'db.operation.name': entry.name });
  }
  client.on('commandSucceeded', event => finish(event, 200));
  client.on('commandFailed', event => finish(event, 503));
  try { await client.connect(); return { client, db: client.db(database) }; }
  catch { await client.close(); throw new Error('MongoDB is unavailable. Check its connection configuration.'); }
}
