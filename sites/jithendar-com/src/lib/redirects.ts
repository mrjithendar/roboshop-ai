import { eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";

/**
 * Record old → new after a slug change. Existing redirects that pointed at the old path are
 * re-pointed (no chains), and a redirect *from* the new path is removed (the URL is live again).
 */
export async function recordRedirect(fromPath: string, toPath: string, db?: Db) {
  if (fromPath === toPath) return;
  const d = db ?? (await getDb());
  await d.update(schema.redirect).set({ toPath }).where(eq(schema.redirect.toPath, fromPath));
  await d.delete(schema.redirect).where(eq(schema.redirect.fromPath, toPath));
  await d.insert(schema.redirect).values({ fromPath, toPath }).onConflictDoUpdate({ target: schema.redirect.fromPath, set: { toPath } });
}

/** Where an unknown path moved to, if anywhere. */
export async function findRedirect(path: string): Promise<string | undefined> {
  if (process.env.CONTENT_DIR) return undefined;
  try {
    const db = await getDb();
    const [row] = await db.select({ toPath: schema.redirect.toPath }).from(schema.redirect).where(eq(schema.redirect.fromPath, path));
    return row?.toPath;
  } catch {
    return undefined;
  }
}
