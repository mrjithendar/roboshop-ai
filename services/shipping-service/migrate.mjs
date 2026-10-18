import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createPool } from './pool.mjs';
const pool = createPool(process.env.SHIPPING_MIGRATION_DATABASE_URL || process.env.SHIPPING_DATABASE_URL);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(74103106)');
  await client.query('CREATE TABLE IF NOT EXISTS public.shipping_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const sql = readFileSync(new URL('./migrations/001_locations.sql', import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const previous = await client.query('SELECT checksum FROM public.shipping_migrations WHERE version=1');
  if (previous.rowCount && previous.rows[0].checksum !== checksum) throw new Error('Applied migration checksum changed');
  if (!previous.rowCount) { await client.query(sql); await client.query('INSERT INTO public.shipping_migrations(version,checksum) VALUES (1,$1)', [checksum]); }
  const manifest = JSON.parse(readFileSync(new URL('./data/manifest.json', import.meta.url)));
  const current = await client.query("SELECT value FROM shipping.metadata WHERE key='seed'");
  if (current.rows[0]?.value !== manifest.sha256) {
    const raw = gunzipSync(readFileSync(new URL('./data/locations.json.gz', import.meta.url)));
    if (createHash('sha256').update(raw).digest('hex') !== manifest.sha256) throw new Error('Location seed checksum mismatch');
    const seed = JSON.parse(raw);
    await client.query('DELETE FROM shipping.cities; DELETE FROM shipping.countries');
    for (const [code, name] of seed.countries) await client.query('INSERT INTO shipping.countries VALUES ($1,$2)', [code,name]);
    for (let i = 0; i < seed.cities.length; i += 1000) {
      const batch = seed.cities.slice(i,i+1000).map(([id,code,name,ascii,region,lat,lon]) => ({ id, code, name, search: ascii.toLowerCase(), region, lat, lon }));
      await client.query(`INSERT INTO shipping.cities SELECT id,code,name,search,region,lat,lon FROM jsonb_to_recordset($1::jsonb) AS x(id integer,code text,name text,search text,region text,lat double precision,lon double precision)`, [JSON.stringify(batch)]);
    }
    await client.query("INSERT INTO shipping.metadata VALUES ('seed',$1) ON CONFLICT (key) DO UPDATE SET value=excluded.value", [manifest.sha256]);
  }
  await client.query('COMMIT');
  console.log('Shipping migrations and GeoNames seed applied.');
} catch (error) { await client.query('ROLLBACK'); console.error('Shipping migration failed:', error.code || error.message); process.exitCode = 1; }
finally { client.release(); await pool.end(); }
