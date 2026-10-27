import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { setDbForTests, schema, type Db } from "@/db";
import { migrateDb } from "@/db/migrate";

/** Fresh in-memory Postgres (PGlite) with all migrations applied, installed as the app database. */
export async function freshDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrateDb(db);
  setDbForTests(db);
  return db;
}
