import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { invalidateContent } from "./content";
import { isoDateTime, pageFrontmatter } from "./content/schema";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { recordRedirect } from "./redirects";
import { clearAutosave, recordRevision } from "./revisions";
import { ConflictError, unsafeLinks } from "./posts";

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
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  noindex: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});

function canEdit(actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
}

function validate(raw: unknown) {
  const input = pageInput.parse(raw);
  // `body` is stored on the row but is not a frontmatter field (the schema is strict).
  const parsed = pageFrontmatter.safeParse({
    slug: input.slug,
    title: input.title,
    description: input.description,
    updatedAt: input.updatedAt ?? undefined,
    seoTitle: input.seoTitle?.trim() || undefined,
    seoDescription: input.seoDescription?.trim() || undefined,
    noindex: input.noindex,
    sortOrder: input.sortOrder,
  });
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  for (const link of unsafeLinks(input.body)) issues.push(`body: link "${link}" uses a scheme that is not allowed`);
  if (RESERVED_PAGE_SLUGS.has(input.slug)) issues.push(`slug: "${input.slug}" is reserved by the site`);
  if (issues.length > 0) throw new PostError("The page is not valid.", 400, issues);
  return input;
}

/** Save a page. With `baseVersion`, refuses to overwrite a newer save (optimistic concurrency). */
export async function savePage(actor: Actor, originalSlug: string | null, raw: unknown, opts: { baseVersion?: number } = {}) {
  canEdit(actor);
  const input = validate(raw);
  const db = await getDb();
  const values = {
    slug: input.slug,
    title: input.title,
    description: input.description,
    body: input.body,
    updatedAt: input.updatedAt ? new Date(input.updatedAt) : null,
    seoTitle: input.seoTitle?.trim() || null,
    seoDescription: input.seoDescription?.trim() || null,
    noindex: input.noindex,
    sortOrder: input.sortOrder,
    savedAt: new Date(),
  };
  let row: typeof schema.page.$inferSelect | undefined;
  if (originalSlug) {
    const [current] = await db.select().from(schema.page).where(eq(schema.page.slug, originalSlug));
    if (!current) throw new PostError("Page not found.", 404);
    if (current.deletedAt) throw new PostError("This page is in the trash. Restore it first.", 409);
    if (opts.baseVersion !== undefined && opts.baseVersion !== current.version) throw new ConflictError({ version: current.version, savedAt: current.savedAt.toISOString() });
    if (originalSlug !== input.slug) {
      const [clash] = await db.select({ slug: schema.page.slug }).from(schema.page).where(eq(schema.page.slug, input.slug));
      if (clash) throw new PostError(`A page with slug "${input.slug}" already exists.`, 409);
    }
    [row] = await db
      .update(schema.page)
      .set({ ...values, version: current.version + 1 })
      .where(and(eq(schema.page.slug, originalSlug), eq(schema.page.version, current.version)))
      .returning();
    if (!row) throw new ConflictError({ version: current.version + 1, savedAt: new Date().toISOString() });
    if (originalSlug !== input.slug) {
      await recordRedirect(`/${originalSlug}`, `/${input.slug}`);
      // Revision history follows the page to its new slug.
      await db.update(schema.revision).set({ entityId: input.slug }).where(and(eq(schema.revision.entity, "page"), eq(schema.revision.entityId, originalSlug)));
    }
  } else {
    if (RESERVED_PAGE_SLUGS.has(input.slug)) throw new PostError(`slug: "${input.slug}" is reserved by the site`);
    [row] = await db.insert(schema.page).values(values).onConflictDoNothing().returning();
    if (!row) throw new PostError(`A page with slug "${input.slug}" already exists.`, 409);
  }
  const { version: _v, ...snapshot } = row;
  void _v;
  await recordRevision(db, "page", row.slug, row.version, originalSlug ? "update" : "create", snapshot, actor.id);
  await clearAutosave(actor, "page", originalSlug ?? row.slug);
  await audit(actor, originalSlug ? "page.update" : "page.create", input.slug);
  invalidateContent();
  return row;
}

/** Move to the trash (the URL returns 404 until restored). */
export async function trashPage(actor: Actor, slug: string) {
  canEdit(actor);
  const db = await getDb();
  await db.update(schema.page).set({ deletedAt: new Date() }).where(eq(schema.page.slug, slug));
  await audit(actor, "page.trash", slug);
  invalidateContent();
}

export async function restorePage(actor: Actor, slug: string) {
  canEdit(actor);
  const db = await getDb();
  await db.update(schema.page).set({ deletedAt: null }).where(eq(schema.page.slug, slug));
  await audit(actor, "page.restore", slug);
  invalidateContent();
}

/** Permanent deletion, only from the trash. */
export async function deletePage(actor: Actor, slug: string) {
  canEdit(actor);
  const db = await getDb();
  const [gone] = await db.delete(schema.page).where(and(eq(schema.page.slug, slug), isNotNull(schema.page.deletedAt))).returning({ slug: schema.page.slug });
  if (!gone) throw new PostError("Move the page to the trash first.", 409);
  await audit(actor, "page.delete", slug);
  invalidateContent();
}

export type PageFormValue = {
  slug: string;
  title: string;
  description: string;
  body: string;
  updatedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  noindex: boolean;
  sortOrder: number;
};

export function pageRowToForm(row: Record<string, unknown>): PageFormValue {
  const d = row.updatedAt ?? row.updated_at;
  return {
    slug: String(row.slug ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    body: String(row.body ?? ""),
    updatedAt: d ? new Date(String(d instanceof Date ? d.toISOString() : d)).toISOString() : null,
    seoTitle: (row.seoTitle ?? row.seo_title ?? null) as string | null,
    seoDescription: (row.seoDescription ?? row.seo_description ?? null) as string | null,
    noindex: Boolean(row.noindex),
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 100),
  };
}

/**
 * Policy and info pages shipped in content/pages/ (e.g. updated privacy policy, cookies). They are
 * never written to the database automatically: the editor loads one as an unsaved draft for review.
 */
export async function bundledPages(): Promise<Map<string, PageFormValue>> {
  const { contentRoot, loadContent } = await import("./content/load");
  const out = new Map<string, PageFormValue>();
  try {
    for (const p of loadContent(contentRoot()).pages.values()) {
      out.set(p.slug, pageRowToForm({ ...p.frontmatter, body: p.body, updatedAt: p.frontmatter.updatedAt ?? null }));
    }
  } catch {
    /* bundled content unavailable */
  }
  return out;
}
