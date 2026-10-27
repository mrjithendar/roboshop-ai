import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<Db> };

/**
 * Production: DATABASE_URL (Postgres via postgres.js).
 * Local dev without DATABASE_URL: an embedded PGlite database in .data/pglite.
 */
async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 5), prepare: false });
    return drizzle(client, { schema }) as unknown as Db;
  }
  if (process.env.NODE_ENV === "production" && process.env.APP_ENV === "production") {
    throw new Error("DATABASE_URL is required in production.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(process.env.PGLITE_DIR ?? ".data/pglite");
  const db = drizzle(client, { schema }) as unknown as Db;
  const { migrateDb } = await import("./migrate");
  await migrateDb(db);
  return db;
}

export function getDb(): Promise<Db> {
  globalForDb.__db ??= connect();
  return globalForDb.__db;
}

/** Tests: swap in an isolated database. */
export function setDbForTests(db: Db | undefined) {
  globalForDb.__db = db ? Promise.resolve(db) : undefined;
}
