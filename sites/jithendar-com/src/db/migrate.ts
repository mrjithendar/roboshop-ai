import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "./index";

const LOCK_ID = 7_250_031; // arbitrary, constant advisory-lock key for this app's migrations

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "db", "migrations");
}

/** Apply pending drizzle-kit SQL migrations in order, once, under an advisory lock (safe with several replicas). */
export async function migrateDb(db: Db, dir: string = migrationsDir()): Promise<string[]> {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  await db.execute(sql`select pg_advisory_lock(${LOCK_ID})`);
  try {
    await db.execute(sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const rows = (await db.execute(sql`select name from schema_migrations`)) as unknown as { rows?: { name: string }[] } & { name: string }[];
    const done = new Set((rows.rows ?? rows).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const statements = fs
        .readFileSync(path.join(dir, file), "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      await db.transaction(async (tx) => {
        for (const statement of statements) await tx.execute(sql.raw(statement));
        await tx.execute(sql`insert into schema_migrations (name) values (${file})`);
      });
      applied.push(file);
    }
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${LOCK_ID})`);
  }
  return applied;
}
