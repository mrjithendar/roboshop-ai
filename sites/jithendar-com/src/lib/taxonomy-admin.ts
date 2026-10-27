import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { rowsOf } from "@/db/rows";
import { iconNames } from "@/components/icons";
import { toneNames } from "@/components/categoryStyle";
import { defaultCategories } from "@/config/taxonomy";
import { audit } from "./audit";
import { invalidateCategories } from "./categories";
import { invalidateContent } from "./content";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { recordRedirect } from "./redirects";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case").max(60);

export const categoryInput = z.object({
  slug,
  label: z.string().trim().min(2).max(60),
  intro: z.string().trim().min(40, "intro needs at least 40 characters (it is the topic page's unique text)").max(300),
  icon: z.string().refine((v) => iconNames.includes(v), "unknown icon"),
  tone: z.string().refine((v) => toneNames.includes(v), "unknown colour"),
  sort: z.coerce.number().int().min(0).max(10_000).default(100),
});

function staff(actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
}

function issuesOf(error: z.ZodError) {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

/** Copy the built-in categories into the table if it is empty (first run). */
export async function seedCategories() {
  const db = await getDb();
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.category)) as [{ n: number }];
  if (n > 0) return 0;
  await db.insert(schema.category).values(defaultCategories).onConflictDoNothing();
  invalidateCategories();
  return defaultCategories.length;
}

export async function saveCategory(actor: Actor, originalSlug: string | null, raw: unknown) {
  staff(actor);
  const parsed = categoryInput.safeParse(raw);
  if (!parsed.success) throw new PostError("The category is not valid.", 400, issuesOf(parsed.error));
  const c = parsed.data;
  const db = await getDb();
  await seedCategories();
  if (originalSlug && originalSlug !== c.slug) {
    const [clash] = await db.select({ slug: schema.category.slug }).from(schema.category).where(eq(schema.category.slug, c.slug));
    if (clash) throw new PostError(`Category "${c.slug}" already exists.`, 409);
    await db.transaction(async (tx) => {
      await tx.insert(schema.category).values(c);
      await tx.update(schema.post).set({ category: c.slug }).where(eq(schema.post.category, originalSlug));
      await tx.delete(schema.category).where(eq(schema.category.slug, originalSlug));
      await recordRedirect(`/category/${originalSlug}`, `/category/${c.slug}`, tx as never);
    });
  } else if (originalSlug) {
    await db.update(schema.category).set({ ...c, updatedAt: new Date() }).where(eq(schema.category.slug, originalSlug));
  } else {
    const inserted = await db.insert(schema.category).values(c).onConflictDoNothing().returning({ slug: schema.category.slug });
    if (inserted.length === 0) throw new PostError(`Category "${c.slug}" already exists.`, 409);
  }
  await audit(actor, originalSlug ? "category.update" : "category.create", c.slug, originalSlug && originalSlug !== c.slug ? { from: originalSlug } : undefined);
  invalidateCategories();
  invalidateContent();
}

export async function deleteCategory(actor: Actor, slugToDelete: string) {
  staff(actor);
  const db = await getDb();
  await seedCategories();
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.post).where(eq(schema.post.category, slugToDelete))) as [{ n: number }];
  if (n > 0) throw new PostError(`"${slugToDelete}" is used by ${n} post(s). Move them to another category first.`, 409);
  await db.delete(schema.category).where(eq(schema.category.slug, slugToDelete));
  await audit(actor, "category.delete", slugToDelete);
  invalidateCategories();
}

/** All tags in use with counts (any status), for the admin. */
export async function tagUsage() {
  const db = await getDb();
  return rowsOf<{ tag: string; n: number }>(
    await db.execute(sql`select tag, count(*)::int as n from post, unnest(tags) as tag group by tag order by n desc, tag`),
  );
}

const tagName = z.string().trim().toLowerCase().min(1).max(40);

/** Rename a tag everywhere; renaming onto an existing tag merges them (no duplicates left behind). */
export async function renameTag(actor: Actor, from: string, to: string) {
  staff(actor);
  const target = tagName.parse(to);
  const db = await getDb();
  await db.execute(sql`
    update post set tags = (
      select coalesce(array_agg(distinct t order by t), '{}')
      from unnest(array_replace(tags, ${from}, ${target})) as t
    )
    where ${from} = any(tags)`);
  await audit(actor, "tag.rename", from, { to: target });
  invalidateContent();
}

export async function deleteTag(actor: Actor, tag: string) {
  staff(actor);
  const db = await getDb();
  await db.execute(sql`update post set tags = array_remove(tags, ${tag}) where ${tag} = any(tags)`);
  await audit(actor, "tag.delete", tag);
  invalidateContent();
}
