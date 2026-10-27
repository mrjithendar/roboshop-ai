import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { migrateDb } from "@/db/migrate";
import { freshDb } from "./db-helpers";

describe("database migrations", () => {
  it("apply once and are idempotent", async () => {
    const db = await freshDb();
    expect(await migrateDb(db)).toEqual([]);
    const result = (await db.execute(sql`select count(*)::int as n from schema_migrations`)) as unknown as { rows: { n: number }[] };
    expect(result.rows[0]!.n).toBeGreaterThan(0);
  });

  it("creates every application table", async () => {
    const db = await freshDb();
    const result = (await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    )) as unknown as { rows: { table_name: string }[] };
    const tables = result.rows.map((r) => r.table_name);
    for (const t of ["user", "session", "account", "verification", "rate_limit", "author_profile", "post", "page", "setting", "comment", "contact_message", "media", "api_key", "audit_log"]) {
      expect(tables).toContain(t);
    }
  });
});
