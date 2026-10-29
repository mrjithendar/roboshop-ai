import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { collections, type Collection } from "@/config/taxonomy";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import type { Role } from "./auth";
import { invalidateContent } from "./content";
import { collectionSchema, isoDateTime } from "./content/schema";
import { getCategoryMap } from "./categories";
import { recordRedirect } from "./redirects";
import { imageRefs } from "./images";
import { resolveImage } from "./media";
import { toIsoOffset } from "./dates-iso";
import { queueIndexNow } from "./indexnow";
import { log } from "./log";
import { clearAutosave, recordRevision } from "./revisions";

export type Actor = { id: string; role: Role; label: string };

export const postInput = z.object({
  collection: z.enum(collections),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  body: z.string().max(200_000).default(""),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  contentType: z.string(),
  status: z.enum(["draft", "review", "scheduled", "published", "archived"]).default("draft"),
  publishedAt: isoDateTime.nullish(),
  updatedAt: isoDateTime.nullish(),
  canonicalUrl: z.string().nullish(),
  featuredImage: z
    .object({ src: z.string(), alt: z.string(), width: z.number(), height: z.number(), focalX: z.number().min(0).max(100).optional(), focalY: z.number().min(0).max(100).optional() })
    .nullish(),
  sources: z.array(z.object({ title: z.string(), url: z.string(), publisher: z.string() })).default([]),
  corrections: z.array(z.object({ date: z.string(), note: z.string() })).default([]),
  sponsored: z.boolean().default(false),
  sponsor: z.string().nullish(),
  related: z.array(z.string()).default([]),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  socialTitle: z.string().nullish(),
  socialDescription: z.string().nullish(),
  socialImage: z.object({ src: z.string(), alt: z.string(), width: z.number(), height: z.number(), focalX: z.number().min(0).max(100).optional(), focalY: z.number().min(0).max(100).optional() }).nullish(),
  noindex: z.boolean().default(false),
});

export type PostInput = z.input<typeof postInput>;
type ParsedInput = z.output<typeof postInput>;
export type PostRow = typeof schema.post.$inferSelect;

export class PostError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

async function authorSlugFor(userId: string): Promise<string> {
  const db = await getDb();
  const [p] = await db.select({ slug: schema.authorProfile.slug }).from(schema.authorProfile).where(eq(schema.authorProfile.userId, userId));
  if (!p) throw new PostError("Your account has no author profile yet. Ask an admin to create one.", 403);
  return p.slug;
}

/** Validate with the exact schema the public site reads with, plus database-level checks. */
async function validate(input: ParsedInput, authorId: string, selfId?: string) {
  const author = await authorSlugFor(authorId);
  // `collection` and `body` are stored on the row but are not frontmatter fields (the schema is strict).
  const { collection: _collection, body: _body, ...frontmatter } = input;
  void _collection;
  void _body;
  const result = collectionSchema(input.collection).safeParse({
    ...frontmatter,
    author,
    publishedAt: input.publishedAt ?? undefined,
    updatedAt: input.updatedAt ?? undefined,
    canonicalUrl: input.canonicalUrl || undefined,
    featuredImage: input.featuredImage ?? undefined,
    sponsor: input.sponsor || undefined,
    seoTitle: input.seoTitle?.trim() || undefined,
    seoDescription: input.seoDescription?.trim() || undefined,
    socialTitle: input.socialTitle?.trim() || undefined,
    socialDescription: input.socialDescription?.trim() || undefined,
    socialImage: input.socialImage ?? undefined,
  });
  const issues = result.success ? [] : result.error.issues.map((i) => `${i.path.join(".") || "post"}: ${i.message}`);
  if (!(await getCategoryMap()).has(input.category)) issues.push(`category: "${input.category}" does not exist`);

  for (const ref of imageRefs(input.body)) {
    if (!ref.alt?.trim()) issues.push(`body: image ${ref.src} needs alt text`);
    if (/^(https?:)?\/\//i.test(ref.src)) issues.push(`body: remote image ${ref.src} is not allowed; upload it to Media`);
    else if (!(await resolveImage(ref.src))) issues.push(`body: image ${ref.src} not found`);
  }
  if (input.featuredImage && !(await resolveImage(input.featuredImage.src))) issues.push(`featuredImage: ${input.featuredImage.src} not found`);
  if (input.socialImage && !(await resolveImage(input.socialImage.src))) issues.push(`socialImage: ${input.socialImage.src} not found`);
  if (input.canonicalUrl && data(input).ownUrl === input.canonicalUrl) issues.push("canonicalUrl: leave empty when it is this post's own URL");
  for (const link of unsafeLinks(input.body)) issues.push(`body: link "${link}" uses a scheme that is not allowed`);

  if (input.related.length > 0) {
    const db = await getDb();
    const rows = await db.select({ collection: schema.post.collection, slug: schema.post.slug, id: schema.post.id }).from(schema.post);
    const known = new Set(rows.filter((r) => r.id !== selfId).map((r) => `${r.collection}/${r.slug}`));
    for (const ref of input.related) if (!known.has(ref)) issues.push(`related: "${ref}" does not exist`);
  }
  if (issues.length > 0) throw new PostError("The post is not valid.", 400, issues);
  return result.success ? result.data : undefined;
}

function toRow(input: ParsedInput, data: NonNullable<Awaited<ReturnType<typeof validate>>>) {
  return {
    collection: input.collection,
    slug: data.slug,
    title: data.title,
    description: data.description,
    body: input.body,
    category: data.category,
    tags: data.tags,
    contentType: data.contentType,
    status: data.status,
    publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
    updatedAt: data.updatedAt ? new Date(data.updatedAt) : null,
    canonicalUrl: data.canonicalUrl ?? null,
    featuredImage: data.featuredImage ?? null,
    sources: data.sources,
    corrections: data.corrections,
    sponsored: data.sponsored,
    sponsor: data.sponsor ?? null,
    related: data.related,
    seoTitle: data.seoTitle ?? null,
    seoDescription: data.seoDescription ?? null,
    socialTitle: data.socialTitle ?? null,
    socialDescription: data.socialDescription ?? null,
    socialImage: data.socialImage ?? null,
    noindex: data.noindex,
    savedAt: new Date(),
  };
}

function data(input: { collection: string; slug: string }) {
  return { ownUrl: `${(process.env.SITE_URL ?? "https://jithendar.com").replace(/\/+$/, "")}/${input.collection}/${input.slug}` };
}

/** Markdown links/images whose URL scheme could run script or leave the web (javascript:, data:, vbscript:, …). */
export function unsafeLinks(markdown: string): string[] {
  const found: string[] = [];
  for (const m of markdown.matchAll(/\]\(\s*<?([^)\s>]+)/g)) {
    const url = m[1]!;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
    if (scheme && !["http", "https", "mailto"].includes(scheme)) found.push(url.slice(0, 60));
  }
  return found;
}

/** Public URL of a post if readers can currently see it (used to notify search engines of changes). */
function visiblePath(row: PostRow, now = Date.now()): string | null {
  const live = row.status === "published" && row.publishedAt && row.publishedAt.getTime() <= now && !row.deletedAt;
  return live ? `/${row.collection}/${row.slug}` : null;
}

/** After a committed change: refresh caches everywhere and tell IndexNow engines. Never throws. */
async function afterChange(before: PostRow | null, after: PostRow | null) {
  invalidateContent();
  const paths = [before && visiblePath(before), after && visiblePath(after)].filter((p): p is string => Boolean(p));
  if (paths.length) await queueIndexNow(paths).catch((err) => log.warn("IndexNow queueing failed", { err }));
}

/** Admins manage every post; authors create, edit, publish and delete their own. */
function canTouch(actor: Actor, row: PostRow) {
  return actor.role === "admin" || (actor.role === "author" && row.authorId === actor.id);
}

function uniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function getPostRow(actor: Actor, id: string): Promise<PostRow> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new PostError("Post not found.", 404);
  const db = await getDb();
  const [row] = await db.select().from(schema.post).where(eq(schema.post.id, id));
  if (!row || !canTouch(actor, row)) throw new PostError("Post not found.", 404);
  return row;
}

export async function listPosts(actor: Actor, filter: { status?: string; collection?: Collection; q?: string; limit?: number; offset?: number } = {}) {
  if (actor.role === "user") throw new PostError("Not allowed.", 403);
  const db = await getDb();
  const q = filter.q?.trim().slice(0, 100);
  const where = and(
    actor.role === "author" ? eq(schema.post.authorId, actor.id) : undefined,
    // "trash" lists deleted posts; every other view hides them.
    filter.status === "trash" ? isNotNull(schema.post.deletedAt) : isNull(schema.post.deletedAt),
    filter.status && filter.status !== "trash" ? eq(schema.post.status, filter.status) : undefined,
    filter.collection ? eq(schema.post.collection, filter.collection) : undefined,
    q ? or(ilike(schema.post.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`), ilike(schema.post.slug, `%${q.replace(/[%_\\]/g, "\\$&")}%`)) : undefined,
  );
  return db
    .select()
    .from(schema.post)
    .where(where)
    .orderBy(desc(schema.post.savedAt))
    .limit(Math.min(filter.limit ?? 50, 200))
    .offset(filter.offset ?? 0);
}

export async function createPost(actor: Actor, raw: unknown): Promise<PostRow> {
  if (actor.role === "user") throw new PostError("Not allowed.", 403);
  const input = postInput.parse(raw);
  const data = (await validate(input, actor.id))!;
  const db = await getDb();
  try {
    const [row] = await db.insert(schema.post).values({ ...toRow(input, data), authorId: actor.id }).returning();
    await recordRevision(db, "post", row!.id, row!.version, "create", snapshot(row!), actor.id);
    await audit(actor, "post.create", row!.id, { slug: row!.slug, status: row!.status });
    await afterChange(null, row!);
    return row!;
  } catch (error) {
    if (uniqueViolation(error)) throw new PostError(`A ${input.collection} post with slug "${data.slug}" already exists.`, 409);
    throw error;
  }
}

export class ConflictError extends PostError {
  constructor(readonly current: { version: number; savedAt: string }) {
    super("Someone saved a newer version of this post (in another tab or by another editor). Load it, or overwrite it with yours.", 409);
  }
}

/** Committed state without the concurrency counter (what a revision stores). */
const snapshot = (row: PostRow) => {
  const { version: _v, ...rest } = row;
  void _v;
  return rest;
};

/**
 * Partial update: fields not supplied keep their current values. With `baseVersion`, the save only
 * succeeds if nobody committed since the editor loaded that version (optimistic concurrency).
 */
export async function updatePost(actor: Actor, id: string, patch: unknown, opts: { baseVersion?: number; reason?: string } = {}): Promise<PostRow> {
  const current = await getPostRow(actor, id);
  if (current.deletedAt) throw new PostError("This post is in the trash. Restore it first.", 409);
  if (opts.baseVersion !== undefined && opts.baseVersion !== current.version) throw new ConflictError({ version: current.version, savedAt: current.savedAt.toISOString() });
  const iso = (d: Date | null) => (d ? toIsoOffset(d) : null);
  const merged = postInput.parse({
    ...current,
    publishedAt: iso(current.publishedAt),
    updatedAt: iso(current.updatedAt),
    ...(typeof patch === "object" && patch ? patch : {}),
  });
  const data = (await validate(merged, current.authorId, id))!;
  const db = await getDb();
  try {
    const [row] = await db
      .update(schema.post)
      .set({ ...toRow(merged, data), version: current.version + 1 })
      .where(and(eq(schema.post.id, id), eq(schema.post.version, current.version)))
      .returning();
    if (!row) {
      const [latest] = await db.select().from(schema.post).where(eq(schema.post.id, id));
      throw new ConflictError({ version: latest?.version ?? current.version, savedAt: (latest?.savedAt ?? current.savedAt).toISOString() });
    }
    const oldPath = `/${current.collection}/${current.slug}`;
    const newPath = `/${row.collection}/${row.slug}`;
    if (oldPath !== newPath) await recordRedirect(oldPath, newPath);
    await recordRevision(db, "post", id, row.version, opts.reason ?? (row.status === "published" ? "update" : "save"), snapshot(row), actor.id);
    await clearAutosave(actor, "post", id);
    await audit(actor, "post.update", id, { slug: row.slug, status: row.status, version: row.version });
    await afterChange(current, row);
    return row;
  } catch (error) {
    if (uniqueViolation(error)) throw new PostError(`A ${merged.collection} post with slug "${data.slug}" already exists.`, 409);
    throw error;
  }
}

/**
 * Publish now, or schedule when the publication time is in the future. Keeps the original
 * publication date of a post that was published before (e.g. imported or republished).
 */
export async function publishPost(actor: Actor, id: string, patch: Record<string, unknown>, opts: { baseVersion?: number } = {}, now = new Date()) {
  const current = await getPostRow(actor, id);
  const when = typeof patch.publishedAt === "string" && patch.publishedAt ? new Date(patch.publishedAt) : (current.publishedAt ?? now);
  const scheduled = when.getTime() > now.getTime() + 30_000;
  return updatePost(actor, id, { ...patch, status: scheduled ? "scheduled" : "published", publishedAt: toIsoOffset(when) }, { ...opts, reason: scheduled ? "schedule" : "publish" });
}

/** Server-side scheduler (lib/scheduler.ts): publish every scheduled post whose time has come. Idempotent. */
export async function publishDuePosts(now = new Date()): Promise<string[]> {
  const db = await getDb();
  const due = await db
    .select()
    .from(schema.post)
    .where(and(eq(schema.post.status, "scheduled"), isNull(schema.post.deletedAt), sql`${schema.post.publishedAt} <= ${now.toISOString()}`));
  const published: string[] = [];
  for (const before of due) {
    // Conditional update: two replicas (or a retry) can never publish the same post twice.
    const [row] = await db
      .update(schema.post)
      .set({ status: "published", version: before.version + 1, savedAt: new Date() })
      .where(and(eq(schema.post.id, before.id), eq(schema.post.status, "scheduled"), eq(schema.post.version, before.version)))
      .returning();
    if (!row) continue;
    await recordRevision(db, "post", row.id, row.version, "scheduled-publish", snapshot(row), null);
    await audit({ id: null, label: "scheduler" }, "post.publish.scheduled", row.id, { slug: row.slug, publishedAt: row.publishedAt?.toISOString() });
    await afterChange(before, row);
    published.push(row.id);
  }
  return published;
}

/** Move to the trash: hidden from readers and lists, restorable. */
export async function trashPost(actor: Actor, id: string): Promise<void> {
  const row = await getPostRow(actor, id);
  if (row.deletedAt) return;
  const db = await getDb();
  const [after] = await db.update(schema.post).set({ deletedAt: new Date(), version: row.version + 1 }).where(eq(schema.post.id, id)).returning();
  await audit(actor, "post.trash", id, { slug: row.slug });
  await afterChange(row, after ?? null);
}

export async function restorePost(actor: Actor, id: string): Promise<void> {
  const row = await getPostRow(actor, id);
  if (!row.deletedAt) return;
  const db = await getDb();
  const [after] = await db.update(schema.post).set({ deletedAt: null, version: row.version + 1 }).where(eq(schema.post.id, id)).returning();
  await audit(actor, "post.restore", id, { slug: row.slug });
  await afterChange(null, after ?? null);
}

/** Permanent deletion: only from the trash (revisions are kept for the audit trail). */
export async function deletePostPermanently(actor: Actor, id: string): Promise<void> {
  const row = await getPostRow(actor, id);
  if (!row.deletedAt) throw new PostError("Move the post to the trash first.", 409);
  const db = await getDb();
  await db.delete(schema.post).where(eq(schema.post.id, id));
  await audit(actor, "post.delete", id, { slug: row.slug });
  invalidateContent();
}

/** API compatibility: DELETE moves to the trash, then deletes permanently. */
export async function deletePost(actor: Actor, id: string): Promise<void> {
  await trashPost(actor, id);
  await deletePostPermanently(actor, id);
}

/** A new draft copy with a unique slug; never published, no dates. */
export async function duplicatePost(actor: Actor, id: string): Promise<PostRow> {
  const src = await getPostRow(actor, id);
  const db = await getDb();
  const taken = new Set((await db.select({ slug: schema.post.slug }).from(schema.post).where(eq(schema.post.collection, src.collection))).map((r) => r.slug));
  const base = `${src.slug.slice(0, 70)}-copy`;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  const title = src.title.length <= 103 ? `${src.title} (copy)` : src.title;
  const [row] = await db
    .insert(schema.post)
    .values({ ...snapshot(src), id: undefined, slug, title, status: "draft", publishedAt: null, updatedAt: null, deletedAt: null, authorId: actor.id, createdAt: new Date(), savedAt: new Date(), corrections: [] })
    .returning();
  await recordRevision(db, "post", row!.id, row!.version, "duplicate", snapshot(row!), actor.id);
  await audit(actor, "post.duplicate", row!.id, { from: id, slug });
  return row!;
}

export async function postCounts() {
  const db = await getDb();
  const rows = await db
    .select({ status: sql<string>`case when ${schema.post.deletedAt} is not null then 'trash' else ${schema.post.status} end`, n: sql<number>`count(*)::int` })
    .from(schema.post)
    .groupBy(sql`1`);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}
