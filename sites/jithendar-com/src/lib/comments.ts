import { and, asc, count, desc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { log } from "./log";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { getSettings } from "./settings";
import { verifyTurnstile } from "./turnstile";

export const COMMENT_MIN = 2;
export const COMMENT_MAX = 5000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
export const MODERATION = ["approved", "rejected", "spam", "pending"] as const;
export type ModerationStatus = (typeof MODERATION)[number];

export type PublicComment = { id: string; author: string; body: string; createdAt: Date };

export async function approvedComments(postId: string): Promise<PublicComment[]> {
  const db = await getDb();
  return db
    .select({ id: schema.comment.id, author: schema.user.name, body: schema.comment.body, createdAt: schema.comment.createdAt })
    .from(schema.comment)
    .innerJoin(schema.user, eq(schema.user.id, schema.comment.userId))
    .where(and(eq(schema.comment.postId, postId), eq(schema.comment.status, "approved")))
    .orderBy(asc(schema.comment.createdAt));
}

/**
 * Signed-in readers comment after a Turnstile check; their comments wait for moderation.
 * Authors' and admins' comments are approved immediately. Max 5 comments per 10 minutes per account.
 */
export async function submitComment(
  user: { id: string; role: string },
  postId: string,
  body: string,
  turnstileToken: string | null,
  ip?: string | null,
): Promise<"approved" | "pending"> {
  if (!(await getSettings()).features.comments) throw new PostError("Comments are closed.", 403);
  const text = body.trim();
  if (text.length < COMMENT_MIN || text.length > COMMENT_MAX) throw new PostError(`Comments must be ${COMMENT_MIN}–${COMMENT_MAX} characters.`);
  if (!(await verifyTurnstile(turnstileToken, ip))) throw new PostError("Please complete the human verification again.", 400);
  const db = await getDb();
  const [post] = await db.select({ id: schema.post.id, status: schema.post.status }).from(schema.post).where(eq(schema.post.id, postId));
  if (!post || post.status !== "published") throw new PostError("This post is not open for comments.", 404);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.comment)
    .where(and(eq(schema.comment.userId, user.id), gt(schema.comment.createdAt, new Date(Date.now() - RATE_WINDOW_MS))));
  if (n >= RATE_MAX) throw new PostError("You are commenting too quickly. Please wait a few minutes.", 400);
  const status = user.role === "admin" || user.role === "author" ? "approved" : "pending";
  await db.insert(schema.comment).values({ postId, userId: user.id, body: text, status });
  log.info("comment submitted", { postId, status });
  return status;
}

export async function moderationQueue(status: ModerationStatus | "all" = "pending") {
  const db = await getDb();
  return db
    .select({ comment: schema.comment, author: schema.user.name, email: schema.user.email, post: schema.post.title, collection: schema.post.collection, slug: schema.post.slug })
    .from(schema.comment)
    .innerJoin(schema.user, eq(schema.user.id, schema.comment.userId))
    .innerJoin(schema.post, eq(schema.post.id, schema.comment.postId))
    .where(status === "all" ? undefined : eq(schema.comment.status, status))
    .orderBy(desc(schema.comment.createdAt))
    .limit(200);
}

export async function moderateComment(actor: Actor, id: string, status: ModerationStatus | "delete") {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  const db = await getDb();
  if (status === "delete") await db.delete(schema.comment).where(eq(schema.comment.id, id));
  else await db.update(schema.comment).set({ status, moderatedAt: new Date(), moderatedBy: actor.id }).where(eq(schema.comment.id, id));
  await audit(actor, `comment.${status}`, id);
}
