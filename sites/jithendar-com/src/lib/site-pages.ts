import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { invalidateContent } from "./content";
import { isoDateTime, pageFrontmatter } from "./content/schema";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { recordRedirect } from "./redirects";

/** Top-level paths owned by the application; a page slug can never shadow them. */
export const RESERVED_PAGE_SLUGS = new Set([
  "admin", "api", "account", "login", "setup", "search", "media", "images", "authors", "category", "tag",
  "blog", "news", "projects", "feed", "page", "_next", "favicon.ico", "robots.txt", "sitemap.xml",
]);

const pageInput = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  body: z.string().max(200_000).default(""),
  updatedAt: isoDateTime.nullish(),
});

function canEdit(actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
}

function validate(raw: unknown) {
  const input = pageInput.parse(raw);
  const parsed = pageFrontmatter.safeParse({ ...input, updatedAt: input.updatedAt ?? undefined });
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  if (RESERVED_PAGE_SLUGS.has(input.slug)) issues.push(`slug: "${input.slug}" is reserved by the site`);
  if (issues.length > 0) throw new PostError("The page is not valid.", 400, issues);
  return input;
}

export async function savePage(actor: Actor, originalSlug: string | null, raw: unknown) {
  canEdit(actor);
  const input = validate(raw);
  const db = await getDb();
  const values = { slug: input.slug, title: input.title, description: input.description, body: input.body, updatedAt: input.updatedAt ? new Date(input.updatedAt) : null, savedAt: new Date() };
  if (originalSlug && originalSlug !== input.slug) {
    const [clash] = await db.select({ slug: schema.page.slug }).from(schema.page).where(eq(schema.page.slug, input.slug));
    if (clash) throw new PostError(`A page with slug "${input.slug}" already exists.`, 409);
    await db.update(schema.page).set(values).where(eq(schema.page.slug, originalSlug));
    await recordRedirect(`/${originalSlug}`, `/${input.slug}`);
  } else if (originalSlug) {
    await db.update(schema.page).set(values).where(eq(schema.page.slug, originalSlug));
  } else {
    const inserted = await db.insert(schema.page).values(values).onConflictDoNothing().returning({ slug: schema.page.slug });
    if (inserted.length === 0) throw new PostError(`A page with slug "${input.slug}" already exists.`, 409);
  }
  await audit(actor, originalSlug ? "page.update" : "page.create", input.slug);
  invalidateContent();
  return input.slug;
}

export async function deletePage(actor: Actor, slug: string) {
  canEdit(actor);
  const db = await getDb();
  await db.delete(schema.page).where(eq(schema.page.slug, slug));
  await audit(actor, "page.delete", slug);
  invalidateContent();
}
