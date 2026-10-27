import { asc } from "drizzle-orm";
import { defaultCategories, type CategoryInfo } from "@/config/taxonomy";
import { broadcastInvalidate, onInvalidate } from "./cache-bus";

export type { CategoryInfo };

const TTL_MS = 30_000;
let cached: { list: CategoryInfo[]; at: number } | undefined;

/**
 * Live categories, sorted. File-based mode (CONTENT_DIR, tests) and an empty or unreachable
 * database fall back to the built-in defaults so the site always renders.
 */
export async function getCategories(): Promise<CategoryInfo[]> {
  if (process.env.CONTENT_DIR) return defaultCategories;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.list;
  let list = defaultCategories;
  try {
    const { getDb, schema } = await import("@/db");
    const db = await getDb();
    const rows = await db.select().from(schema.category).orderBy(asc(schema.category.sort), asc(schema.category.label));
    if (rows.length > 0) list = rows.map(({ slug, label, intro, icon, tone, sort }) => ({ slug, label, intro, icon, tone, sort }));
  } catch {
    return defaultCategories;
  }
  cached = { list, at: Date.now() };
  return list;
}

export async function getCategoryMap(): Promise<Map<string, CategoryInfo>> {
  return new Map((await getCategories()).map((c) => [c.slug, c]));
}

onInvalidate("categories", () => {
  cached = undefined;
});

export function invalidateCategories() {
  broadcastInvalidate("categories");
}

/** Label for display; unknown slugs (a category deleted after use) degrade to the slug itself. */
export function labelOf(map: Map<string, CategoryInfo>, slug: string): string {
  return map.get(slug)?.label ?? slug;
}
