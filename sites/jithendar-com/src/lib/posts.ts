import { and, desc, eq, sql } from "drizzle-orm";
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
  status: z.enum(["draft", "review", "published", "archived"]).default("draft"),
  publishedAt: isoDateTime.nullish(),
  updatedAt: isoDateTime.nullish(),
  canonicalUrl: z.string().nullish(),
  featuredImage: z.object({ src: z.string(), alt: z.string(), width: z.number(), height: z.number() }).nullish(),
  sources: z.array(z.object({ title: z.string(), url: z.string(), publisher: z.string() })).default([]),
  corrections: z.array(z.object({ date: z.string(), note: z.string() })).default([]),
  sponsored: z.boolean().default(false),
  sponsor: z.string().nullish(),
  related: z.array(z.string()).default([]),
});

export type PostInput = z.input<typeof postInput>;
type ParsedInput = z.output<typeof postInput>;
export type PostRow = typeof schema.post.$inferSelect;

export class PostError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
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
  const result = collectionSchema(input.collection).safeParse({
    ...input,
    author,
    publishedAt: input.publishedAt ?? undefined,
    updatedAt: input.updatedAt ?? undefined,
    canonicalUrl: input.canonicalUrl || undefined,
    featuredImage: input.featuredImage ?? undefined,
    sponsor: input.sponsor || undefined,
  });
  const issues = result.success ? [] : result.error.issues.map((i) => `${i.path.join(".") || "post"}: ${i.message}`);
  if (!(await getCategoryMap()).has(input.category)) issues.push(`category: "${input.category}" does not exist`);

  for (const ref of imageRefs(input.body)) {
    if (!ref.alt?.trim()) issues.push(`body: image ${ref.src} needs alt text`);
    if (/^(https?:)?\/\//i.test(ref.src)) issues.push(`body: remote image ${ref.src} is not allowed; upload it to Media`);
    else if (!(await resolveImage(ref.src))) issues.push(`body: image ${ref.src} not found`);
  }
  if (input.featuredImage && !(await resolveImage(input.featuredImage.src))) issues.push(`featuredImage: ${input.featuredImage.src} not found`);

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
    savedAt: new Date(),
  };
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

export async function listPosts(actor: Actor, filter: { status?: string; collection?: Collection; limit?: number; offset?: number } = {}) {
  if (actor.role === "user") throw new PostError("Not allowed.", 403);
  const db = await getDb();
  const where = and(
    actor.role === "author" ? eq(schema.post.authorId, actor.id) : undefined,
    filter.status ? eq(schema.post.status, filter.status) : undefined,
    filter.collection ? eq(schema.post.collection, filter.collection) : undefined,
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
    await audit(actor, "post.create", row!.id, { slug: row!.slug, status: row!.status });
    invalidateContent();
    return row!;
  } catch (error) {
    if (uniqueViolation(error)) throw new PostError(`A ${input.collection} post with slug "${data.slug}" already exists.`, 409);
    throw error;
  }
}

/** Partial update: fields not supplied keep their current values. */
export async function updatePost(actor: Actor, id: string, patch: unknown): Promise<PostRow> {
  const current = await getPostRow(actor, id);
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
    const [row] = await db.update(schema.post).set(toRow(merged, data)).where(eq(schema.post.id, id)).returning();
    const oldPath = `/${current.collection}/${current.slug}`;
    const newPath = `/${row!.collection}/${row!.slug}`;
    if (oldPath !== newPath) await recordRedirect(oldPath, newPath);
    await audit(actor, "post.update", id, { slug: row!.slug, status: row!.status });
    invalidateContent();
    return row!;
  } catch (error) {
    if (uniqueViolation(error)) throw new PostError(`A ${merged.collection} post with slug "${data.slug}" already exists.`, 409);
    throw error;
  }
}

export async function deletePost(actor: Actor, id: string): Promise<void> {
  const row = await getPostRow(actor, id);
  const db = await getDb();
  await db.delete(schema.post).where(eq(schema.post.id, id));
  await audit(actor, "post.delete", id, { slug: row.slug });
  invalidateContent();
}

export async function postCounts() {
  const db = await getDb();
  const rows = await db.select({ status: schema.post.status, n: sql<number>`count(*)::int` }).from(schema.post).groupBy(schema.post.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
