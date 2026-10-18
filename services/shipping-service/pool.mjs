import pg from 'pg';
import { readFileSync } from 'node:fs';
export function createPool(connectionString = process.env.SHIPPING_DATABASE_URL) {
  if (!connectionString) throw new Error('SHIPPING_DATABASE_URL is required. SQLite is not supported.');
  const parsed = new URL(connectionString);
  if ([...parsed.searchParams.keys()].some(k => k.startsWith('ssl'))) throw new Error('Use SHIPPING_DB_TLS and SHIPPING_DB_CA_FILE for TLS configuration.');
  const tls = process.env.SHIPPING_DB_TLS !== 'false';
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000, application_name: 'robotshop-shipping', ssl: tls ? { rejectUnauthorized: true, ...(process.env.SHIPPING_DB_CA_FILE ? { ca: readFileSync(process.env.SHIPPING_DB_CA_FILE, 'utf8') } : {}) } : false });
  pool.on('error', () => console.error('Shipping database connection failed'));
  return pool;
}
