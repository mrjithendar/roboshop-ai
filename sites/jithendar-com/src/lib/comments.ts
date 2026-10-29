import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { COMMENT_MAX, REPORT_NOTE_MAX, REPORT_REASONS, type CommentPage, type CommentSort, type CommentView, type DiscussionState, type ReportReason, type Viewer } from "./comment-types";
import { renderCommentMarkdown } from "./comment-markdown";
import { log } from "./log";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { hit } from "./rate-limit";
import { getSettings } from "./settings";
import { verifyTurnstile } from "./turnstile";

export * from "./comment-types";

export const COMMENT_MIN = 2;

/** Replies are indented at most this many levels; deeper replies are shown at this level with "replying to …". */
export const MAX_DISPLAY_DEPTH = 2;
/** Top-level threads per page. */
export const PAGE_SIZE = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
/** Upper bound on rows read for one post's discussion. */
const MAX_ROWS = 5000;

export const MODERATION_ACTIONS = ["approve", "hide", "restore", "remove", "dismiss", "purge"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];
export const MODERATION_FILTERS = ["pending", "reported", "approved", "hidden", "removed", "all"] as const;
export type ModerationFilter = (typeof MODERATION_FILTERS)[number];
/** Statuses that count as removed (rejected and spam come from the first comment system). */
const REMOVED = ["removed", "rejected", "spam"];

export const DISCUSSION_MODES = ["open", "locked", "closed"] as const;
export type DiscussionMode = (typeof DISCUSSION_MODES)[number];

export type CommentRow = {
  id: string;
  parentId: string | null;
  rootId: string | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  editedAt: Date | null;
  userId: string;
  body: string;
  name: string;
  image: string | null;
  role: string;
  likes: number;
  likedByMe: boolean;
  reportedByMe: boolean;
};

// --- Discussion state ----------------------------------------------------------------------------------

/** The discussion settings for a published post; 404 for anything else (drafts, trash, unknown ids). */
export async function discussionFor(postId: string): Promise<DiscussionState> {
  if (!isUuid(postId)) throw new PostError("This post is not open for comments.", 404);
  const db = await getDb();
  const [post] = await db
    .select({ status: schema.post.status, deletedAt: schema.post.deletedAt, discussion: schema.post.discussion })
    .from(schema.post)
    .where(eq(schema.post.id, postId));
  if (!post || post.status !== "published" || post.deletedAt) throw new PostError("This post is not open for comments.", 404);
  const settings = await getSettings();
  return {
    enabled: settings.features.comments && post.discussion !== "closed",
    locked: post.discussion === "locked",
    requireApproval: settings.discussion.requireApproval,
    editWindowMinutes: settings.discussion.editWindowMinutes,
  };
}

function assertOpen(state: DiscussionState) {
  if (!state.enabled) throw new PostError("Comments are closed.", 403);
  if (state.locked) throw new PostError("This discussion is locked.", 403);
}

// --- Reading -------------------------------------------------------------------------------------------

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function loadRows(postId: string, viewer: Viewer): Promise<CommentRow[]> {
  const db = await getDb();
  const c = schema.comment;
  const rows = await db
    .select({
      id: c.id,
      parentId: c.parentId,
      rootId: c.rootId,
      status: c.status,
      deletedAt: c.deletedAt,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      userId: c.userId,
      body: c.body,
      name: schema.user.name,
      image: schema.user.image,
      role: schema.user.role,
    })
    .from(c)
    .innerJoin(schema.user, eq(schema.user.id, c.userId))
    .where(eq(c.postId, postId))
    .orderBy(asc(c.createdAt), asc(c.id))
    .limit(MAX_ROWS);
  if (rows.length === 0) return [];
  const likes = await db
    .select({ id: schema.commentLike.commentId, n: count() })
    .from(schema.commentLike)
    .innerJoin(c, eq(c.id, schema.commentLike.commentId))
    .where(eq(c.postId, postId))
    .groupBy(schema.commentLike.commentId);
  const likeCount = new Map(likes.map((l) => [l.id, Number(l.n)]));
  let liked = new Set<string>();
  let reported = new Set<string>();
  if (viewer) {
    const [mineLiked, mineReported] = await Promise.all([
      db
        .select({ id: schema.commentLike.commentId })
        .from(schema.commentLike)
        .innerJoin(c, eq(c.id, schema.commentLike.commentId))
        .where(and(eq(c.postId, postId), eq(schema.commentLike.userId, viewer.id))),
      db
        .select({ id: schema.commentReport.commentId })
        .from(schema.commentReport)
        .innerJoin(c, eq(c.id, schema.commentReport.commentId))
        .where(and(eq(c.postId, postId), eq(schema.commentReport.userId, viewer.id))),
    ]);
    liked = new Set(mineLiked.map((r) => r.id));
    reported = new Set(mineReported.map((r) => r.id));
  }
  return rows.map((r) => ({ ...r, likes: likeCount.get(r.id) ?? 0, likedByMe: liked.has(r.id), reportedByMe: reported.has(r.id) }));
}

/** Whether a comment itself may be shown to this viewer (approved; or their own, still pending). */
function shownToViewer(row: CommentRow, viewer: Viewer): boolean {
  if (row.deletedAt) return false;
  return row.status === "approved" || (row.status === "pending" && viewer?.id === row.userId);
}

function withinEditWindow(row: Pick<CommentRow, "createdAt">, state: DiscussionState, now: number): boolean {
  return state.editWindowMinutes === 0 || now - row.createdAt.getTime() <= state.editWindowMinutes * 60_000;
}

type Tree = { byId: Map<string, CommentRow>; children: Map<string, CommentRow[]>; kept: (row: CommentRow) => boolean };

/**
 * Index the rows and decide what survives for this viewer: a comment that may be shown, or one that has a
 * surviving reply (then it becomes a tombstone so the replies keep their place). Everything else is dropped.
 */
function indexRows(rows: CommentRow[], viewer: Viewer): Tree {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, CommentRow[]>();
  for (const r of rows) {
    if (!r.parentId || !byId.has(r.parentId)) continue;
    const list = children.get(r.parentId) ?? [];
    list.push(r);
    children.set(r.parentId, list);
  }
  const memo = new Map<string, boolean>();
  // Iterative post-order walk (reply chains can be long).
  const kept = (row: CommentRow): boolean => {
    if (memo.has(row.id)) return memo.get(row.id)!;
    const stack: [CommentRow, boolean][] = [[row, false]];
    while (stack.length) {
      const [node, expanded] = stack.pop()!;
      if (memo.has(node.id)) continue;
      const kids = children.get(node.id) ?? [];
      if (!expanded) {
        stack.push([node, true]);
        for (const k of kids) if (!memo.has(k.id)) stack.push([k, false]);
      } else {
        memo.set(node.id, shownToViewer(node, viewer) || kids.some((k) => memo.get(k.id)));
      }
    }
    return memo.get(row.id)!;
  };
  return { byId, children, kept };
}

const byTime = (a: CommentRow, b: CommentRow) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

function toView(row: CommentRow, level: number, tree: Tree, viewer: Viewer, state: DiscussionState, now: number, replyTo: CommentView["replyTo"]): CommentView {
  const visible = shownToViewer(row, viewer);
  const mine = !!viewer && viewer.id === row.userId;
  const open = state.enabled && !state.locked;
  const approved = visible && row.status === "approved";
  const kids = (tree.children.get(row.id) ?? []).filter(tree.kept).sort(byTime);
  let replies: CommentView[] = [];
  if (level + 1 < MAX_DISPLAY_DEPTH) {
    replies = kids.map((k) => toView(k, level + 1, tree, viewer, state, now, null));
  } else if (level + 1 === MAX_DISPLAY_DEPTH) {
    // Last indented level: every deeper reply is listed here in time order, pointing at what it answers.
    const flat: CommentRow[] = [];
    const stack = [...kids];
    while (stack.length) {
      const r = stack.pop()!;
      flat.push(r);
      stack.push(...(tree.children.get(r.id) ?? []).filter(tree.kept));
    }
    replies = flat.sort(byTime).map((r) => {
      const parent = r.parentId ? tree.byId.get(r.parentId) : undefined;
      const to = parent && parent.id !== row.id ? { id: parent.id, name: shownToViewer(parent, viewer) ? parent.name : null } : null;
      return toView(r, MAX_DISPLAY_DEPTH, tree, viewer, state, now, to);
    });
  }
  if (!visible) {
    return {
      id: row.id, parentId: row.parentId, replyTo, tombstone: true, author: null, html: "", createdAt: row.createdAt.toISOString(), editedAt: null,
      likes: 0, likedByMe: false, reportedByMe: false, pending: false, mine: false,
      can: { reply: false, edit: false, delete: false, like: false, report: false }, replies,
    };
  }
  const badge = row.role === "admin" ? "admin" : row.role === "author" ? "author" : null;
  return {
    id: row.id,
    parentId: row.parentId,
    replyTo,
    tombstone: false,
    author: { name: row.name, image: row.image, badge },
    html: renderCommentMarkdown(row.body),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    likes: approved ? row.likes : 0,
    likedByMe: row.likedByMe,
    reportedByMe: row.reportedByMe,
    pending: row.status === "pending",
    mine,
    can: {
      reply: !!viewer && open && approved,
      edit: mine && open && (viewer?.role === "admin" || withinEditWindow(row, state, now)),
      delete: mine,
      like: !!viewer && !mine && open && approved,
      report: !!viewer && !mine && approved && !row.reportedByMe,
    },
    replies,
  };
}

/**
 * Pure: the page of threads for this viewer. Threads are ordered oldest or newest first by their top-level
 * comment; replies are always in time order. `cursor` is the last thread of the previous page.
 */
export function buildPage(
  rows: CommentRow[],
  viewer: Viewer,
  state: DiscussionState,
  opts: { sort: CommentSort; cursor?: string | null; focus?: string | null; limit?: number; now?: number },
): Omit<CommentPage, "state"> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? PAGE_SIZE;
  const tree = indexRows(rows, viewer);
  const total = rows.filter((r) => r.status === "approved" && !r.deletedAt).length;
  let roots = rows.filter((r) => (!r.parentId || !tree.byId.has(r.parentId)) && tree.kept(r)).sort(byTime);
  if (opts.focus) {
    const target = tree.byId.get(opts.focus);
    const root = target ? (target.rootId && tree.byId.get(target.rootId)) || target : null;
    const thread = root && tree.kept(root) ? [toView(root, 0, tree, viewer, state, now, null)] : [];
    return { threads: thread, nextCursor: null, total };
  }
  if (opts.sort === "newest") roots.reverse();
  if (opts.cursor) {
    const i = roots.findIndex((r) => r.id === opts.cursor);
    roots = i >= 0 ? roots.slice(i + 1) : roots;
  }
  const page = roots.slice(0, limit);
  return {
    threads: page.map((r) => toView(r, 0, tree, viewer, state, now, null)),
    nextCursor: roots.length > limit ? page.at(-1)!.id : null,
    total,
  };
}

export async function listComments(
  postId: string,
  viewer: Viewer,
  opts: { sort?: CommentSort; cursor?: string | null; focus?: string | null } = {},
): Promise<CommentPage> {
  const state = await discussionFor(postId);
  if (!state.enabled) return { state, threads: [], nextCursor: null, total: 0 };
  const rows = await loadRows(postId, viewer);
  const cursor = opts.cursor && isUuid(opts.cursor) ? opts.cursor : null;
  const focus = opts.focus && isUuid(opts.focus) ? opts.focus : null;
  return { state, ...buildPage(rows, viewer, state, { sort: opts.sort === "newest" ? "newest" : "oldest", cursor, focus }) };
}

/** Public number of comments on a post (approved, not deleted). */
export async function commentCount(postId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.comment)
    .where(and(eq(schema.comment.postId, postId), eq(schema.comment.status, "approved"), isNull(schema.comment.deletedAt)));
  return Number(row?.n ?? 0);
}

// --- Writing (signed-in readers) -----------------------------------------------------------------------

function cleanBody(body: unknown): string {
  if (typeof body !== "string") throw new PostError("Write a comment first.");
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (text.length < COMMENT_MIN || text.length > COMMENT_MAX) throw new PostError(`Comments must be ${COMMENT_MIN}–${COMMENT_MAX} characters.`);
  return text;
}

/** Preview exactly as the comment will be shown (same renderer, same limits). */
export function previewComment(body: unknown): string {
  return renderCommentMarkdown(cleanBody(body));
}

const CLIENT_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export type SubmitInput = { postId: string; parentId?: string | null; body: unknown; clientKey?: string | null; turnstileToken: string | null; ip?: string | null };

/**
 * Signed-in readers comment or reply after a Turnstile check. With approval required (Admin → Appearance),
 * readers' comments wait for moderation; authors' and admins' are published at once.
 * Protections: 5 comments per 10 minutes per account, the same text twice within 10 minutes is refused, and
 * a resubmitted form (same client key) returns the first comment instead of creating another.
 */
export async function submitComment(user: { id: string; role: string }, input: SubmitInput): Promise<{ id: string; status: "approved" | "pending"; duplicate: boolean }> {
  const state = await discussionFor(input.postId);
  assertOpen(state);
  const text = cleanBody(input.body);
  const clientKey = input.clientKey && CLIENT_KEY.test(input.clientKey) ? input.clientKey : null;
  const db = await getDb();
  const c = schema.comment;

  const existingByKey = async () => {
    if (!clientKey) return null;
    const [row] = await db.select({ id: c.id, status: c.status, postId: c.postId }).from(c).where(and(eq(c.userId, user.id), eq(c.clientKey, clientKey)));
    return row ?? null;
  };
  // Checked before Turnstile: a retried submission carries an already-used token.
  const first = await existingByKey();
  if (first) {
    if (first.postId !== input.postId) throw new PostError("This form was already used. Reload the page and try again.", 409);
    return { id: first.id, status: first.status === "approved" ? "approved" : "pending", duplicate: true };
  }

  if (!(await verifyTurnstile(input.turnstileToken, input.ip))) throw new PostError("Please complete the human verification again.", 400);

  let parent: { id: string; rootId: string | null; depth: number } | null = null;
  if (input.parentId) {
    if (!isUuid(input.parentId)) throw new PostError("That comment does not exist.", 404);
    const [p] = await db
      .select({ id: c.id, postId: c.postId, rootId: c.rootId, depth: c.depth, status: c.status, deletedAt: c.deletedAt })
      .from(c)
      .where(eq(c.id, input.parentId));
    if (!p) throw new PostError("That comment does not exist.", 404);
    if (p.postId !== input.postId) throw new PostError("You can only reply to comments on the same post.", 400);
    if (p.status !== "approved" || p.deletedAt) throw new PostError("That comment can no longer be replied to.", 409);
    parent = p;
  }

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(c)
    .where(and(eq(c.userId, user.id), gt(c.createdAt, new Date(Date.now() - RATE_WINDOW_MS))));
  if (Number(n) >= RATE_MAX) throw new PostError("You are commenting too quickly. Please wait a few minutes.", 429);

  const [same] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.userId, user.id), eq(c.postId, input.postId), eq(c.body, text), isNull(c.deletedAt), gt(c.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS))))
    .limit(1);
  if (same) throw new PostError("You already posted this comment.", 409);

  const staff = user.role === "admin" || user.role === "author";
  const status = staff || !state.requireApproval ? "approved" : "pending";
  try {
    const [row] = await db
      .insert(c)
      .values({
        postId: input.postId,
        userId: user.id,
        body: text,
        status,
        parentId: parent?.id ?? null,
        rootId: parent ? (parent.rootId ?? parent.id) : null,
        depth: parent ? parent.depth + 1 : 0,
        clientKey,
      })
      .returning({ id: c.id });
    log.info("comment submitted", { postId: input.postId, status, reply: !!parent });
    return { id: row!.id, status, duplicate: false };
  } catch (error) {
    // Two submissions with the same key raced: the other one won; return it.
    const winner = await existingByKey();
    if (winner) return { id: winner.id, status: winner.status === "approved" ? "approved" : "pending", duplicate: true };
    throw error;
  }
}

async function ownComment(userId: string, id: string) {
  if (!isUuid(id)) throw new PostError("That comment does not exist.", 404);
  const db = await getDb();
  const [row] = await db.select().from(schema.comment).where(eq(schema.comment.id, id));
  if (!row || row.deletedAt) throw new PostError("That comment does not exist.", 404);
  if (row.userId !== userId) throw new PostError("You can only change your own comments.", 403);
  return row;
}

export async function editComment(user: { id: string; role: string }, id: string, body: unknown): Promise<void> {
  const row = await ownComment(user.id, id);
  if (row.status !== "approved" && row.status !== "pending") throw new PostError("This comment can no longer be edited.", 403);
  const state = await discussionFor(row.postId);
  assertOpen(state);
  if (user.role !== "admin" && !withinEditWindow(row, state, Date.now())) throw new PostError("The time for editing this comment has passed.", 403);
  const text = cleanBody(body);
  if (!(await hit(`comment-edit:${user.id}`, 20, 600))) throw new PostError("Too many edits. Please wait a few minutes.", 429);
  if (text === row.body) return;
  const db = await getDb();
  await db.update(schema.comment).set({ body: text, editedAt: new Date() }).where(eq(schema.comment.id, id));
}

/** The Markdown source of the user's own comment (for the edit form; pages carry only rendered HTML). */
export async function ownCommentSource(user: { id: string }, id: string): Promise<string> {
  return (await ownComment(user.id, id)).body;
}

/** The author deletes their comment: its text is erased; a placeholder stays while it has replies. */
export async function deleteOwnComment(user: { id: string }, id: string): Promise<void> {
  await ownComment(user.id, id);
  const db = await getDb();
  await db.update(schema.comment).set({ body: "", deletedAt: new Date() }).where(eq(schema.comment.id, id));
  log.info("comment deleted by author", { id });
}

async function publicComment(id: string) {
  if (!isUuid(id)) throw new PostError("That comment does not exist.", 404);
  const db = await getDb();
  const [row] = await db.select().from(schema.comment).where(eq(schema.comment.id, id));
  if (!row || row.deletedAt || row.status !== "approved") throw new PostError("That comment does not exist.", 404);
  return row;
}

/** Like or unlike (one like per user per comment, enforced by the primary key). Returns the new count. */
export async function setLike(user: { id: string }, id: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
  const row = await publicComment(id);
  if (row.userId === user.id) throw new PostError("You cannot like your own comment.", 400);
  assertOpen(await discussionFor(row.postId));
  if (!(await hit(`comment-like:${user.id}`, 60, 600))) throw new PostError("Too many likes in a short time. Please wait a moment.", 429);
  const db = await getDb();
  if (liked) await db.insert(schema.commentLike).values({ commentId: id, userId: user.id }).onConflictDoNothing();
  else await db.delete(schema.commentLike).where(and(eq(schema.commentLike.commentId, id), eq(schema.commentLike.userId, user.id)));
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.commentLike).where(eq(schema.commentLike.commentId, id));
  return { likes: Number(n), liked };
}

/** Flag a comment for moderators (once per user per comment). */
export async function reportComment(user: { id: string }, id: string, reason: unknown, note: unknown): Promise<"reported" | "already"> {
  const row = await publicComment(id);
  if (row.userId === user.id) throw new PostError("You cannot report your own comment.", 400);
  if (!REPORT_REASONS.includes(reason as ReportReason)) throw new PostError("Choose a reason.");
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > REPORT_NOTE_MAX) throw new PostError(`Keep the note under ${REPORT_NOTE_MAX} characters.`);
  if (!(await hit(`comment-report:${user.id}`, 10, 3600))) throw new PostError("Too many reports in a short time. Please try again later.", 429);
  const db = await getDb();
  const inserted = await db
    .insert(schema.commentReport)
    .values({ commentId: id, userId: user.id, reason: reason as ReportReason, note: text })
    .onConflictDoNothing()
    .returning({ id: schema.commentReport.id });
  return inserted.length ? "reported" : "already";
}

// --- Moderation (authors and admins) --------------------------------------------------------------------

const NEXT_STATUS: Partial<Record<ModerationAction, string>> = { approve: "approved", restore: "approved", hide: "hidden", remove: "removed" };

/**
 * Approve, hide, restore, remove, dismiss reports, or (admins, comments without replies) delete permanently.
 * Every action is recorded in the audit log and closes the comment's open reports.
 */
export async function moderateComment(actor: Actor, id: string, action: ModerationAction, note = ""): Promise<void> {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  if (!MODERATION_ACTIONS.includes(action)) throw new PostError("Unknown action.");
  if (!isUuid(id)) throw new PostError("That comment does not exist.", 404);
  const reason = note.trim().slice(0, 500);
  const db = await getDb();
  const [row] = await db.select().from(schema.comment).where(eq(schema.comment.id, id));
  if (!row) throw new PostError("That comment does not exist.", 404);
  const [{ n: open } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.commentReport)
    .where(and(eq(schema.commentReport.commentId, id), isNull(schema.commentReport.resolvedAt)));

  if (action === "purge") {
    if (actor.role !== "admin") throw new PostError("Only admins can delete comments permanently.", 403);
    const [reply] = await db.select({ id: schema.comment.id }).from(schema.comment).where(eq(schema.comment.parentId, id)).limit(1);
    if (reply) throw new PostError("This comment has replies. Remove it instead; the replies keep their place.", 409);
    await db.delete(schema.comment).where(eq(schema.comment.id, id));
  } else {
    if (row.deletedAt && action !== "dismiss") throw new PostError("Its author deleted this comment.", 409);
    if (action === "dismiss" && Number(open) === 0) throw new PostError("This comment has no open reports.", 409);
    const status = NEXT_STATUS[action];
    await db.transaction(async (tx) => {
      if (status) await tx.update(schema.comment).set({ status, moderatedAt: new Date(), moderatedBy: actor.id }).where(eq(schema.comment.id, id));
      await tx
        .update(schema.commentReport)
        .set({ resolvedAt: new Date(), resolvedBy: actor.id, resolution: action })
        .where(and(eq(schema.commentReport.commentId, id), isNull(schema.commentReport.resolvedAt)));
    });
  }
  await audit(actor, `comment.${action}`, id, { postId: row.postId, from: row.status, to: NEXT_STATUS[action] ?? (action === "purge" ? "deleted" : row.status), openReports: Number(open), ...(reason ? { note: reason } : {}) });
}

/** Open, lock or close the discussion on one post: admins, or the post's author. */
export async function setDiscussionMode(actor: Actor, postId: string, mode: DiscussionMode): Promise<void> {
  if (!DISCUSSION_MODES.includes(mode)) throw new PostError("Unknown discussion setting.");
  if (!isUuid(postId)) throw new PostError("That post does not exist.", 404);
  const db = await getDb();
  const [post] = await db.select({ authorId: schema.post.authorId, discussion: schema.post.discussion }).from(schema.post).where(eq(schema.post.id, postId));
  if (!post) throw new PostError("That post does not exist.", 404);
  if (actor.role !== "admin" && !(actor.role === "author" && post.authorId === actor.id)) throw new PostError("Only admins and the post's author can change its discussion.", 403);
  if (post.discussion === mode) return;
  await db.update(schema.post).set({ discussion: mode }).where(eq(schema.post.id, postId));
  await audit(actor, "post.discussion", postId, { from: post.discussion, to: mode });
}

export type QueueItem = {
  id: string;
  body: string;
  status: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  moderatedAt: Date | null;
  author: string;
  /** Admins only. */
  email: string | null;
  post: { id: string; title: string; collection: string; slug: string };
  isReply: boolean;
  hasReplies: boolean;
  reports: { reason: string; note: string; createdAt: Date }[];
};

export async function moderationQueue(actor: Actor, filter: ModerationFilter = "pending"): Promise<QueueItem[]> {
  const db = await getDb();
  const c = schema.comment;
  const openReports = db
    .select({ commentId: schema.commentReport.commentId })
    .from(schema.commentReport)
    .where(isNull(schema.commentReport.resolvedAt));
  const where =
    filter === "all"
      ? undefined
      : filter === "reported"
        ? inArray(c.id, openReports)
        : filter === "removed"
          ? inArray(c.status, REMOVED)
          : filter === "approved"
            ? and(eq(c.status, "approved"), isNull(c.deletedAt))
            : and(eq(c.status, filter), isNull(c.deletedAt));
  const rows = await db
    .select({
      comment: c,
      author: schema.user.name,
      email: schema.user.email,
      post: { id: schema.post.id, title: schema.post.title, collection: schema.post.collection, slug: schema.post.slug },
      hasReplies: sql<boolean>`exists (select 1 from ${c} r where r.parent_id = ${c.id})`,
    })
    .from(c)
    .innerJoin(schema.user, eq(schema.user.id, c.userId))
    .innerJoin(schema.post, eq(schema.post.id, c.postId))
    .where(where)
    .orderBy(desc(c.createdAt))
    .limit(200);
  const ids = rows.map((r) => r.comment.id);
  const reports = ids.length
    ? await db
        .select({ commentId: schema.commentReport.commentId, reason: schema.commentReport.reason, note: schema.commentReport.note, createdAt: schema.commentReport.createdAt })
        .from(schema.commentReport)
        .where(and(inArray(schema.commentReport.commentId, ids), isNull(schema.commentReport.resolvedAt)))
        .orderBy(asc(schema.commentReport.createdAt))
    : [];
  return rows.map((r) => ({
    id: r.comment.id,
    body: r.comment.body,
    status: r.comment.status,
    createdAt: r.comment.createdAt,
    editedAt: r.comment.editedAt,
    deletedAt: r.comment.deletedAt,
    moderatedAt: r.comment.moderatedAt,
    author: r.author,
    email: actor.role === "admin" ? r.email : null,
    post: r.post,
    isReply: !!r.comment.parentId,
    hasReplies: Boolean(r.hasReplies),
    reports: reports.filter((x) => x.commentId === r.comment.id).map(({ reason, note, createdAt }) => ({ reason, note, createdAt })),
  }));
}

/** Counts for the moderation tabs and the admin menu badge. */
export async function moderationCounts(): Promise<{ pending: number; reported: number }> {
  const db = await getDb();
  const [[pending], [reported]] = await Promise.all([
    db.select({ n: count() }).from(schema.comment).where(and(eq(schema.comment.status, "pending"), isNull(schema.comment.deletedAt))),
    db
      .select({ n: sql<number>`count(distinct ${schema.commentReport.commentId})` })
      .from(schema.commentReport)
      .where(isNull(schema.commentReport.resolvedAt)),
  ]);
  return { pending: Number(pending?.n ?? 0), reported: Number(reported?.n ?? 0) };
}

/** Published posts with their discussion setting and comment numbers (authors see their own posts). */
export async function discussionsOverview(actor: Actor, q = "") {
  const db = await getDb();
  const p = schema.post;
  const term = q.trim().slice(0, 100);
  return db
    .select({
      id: p.id,
      title: p.title,
      collection: p.collection,
      slug: p.slug,
      discussion: p.discussion,
      comments: sql<number>`(select count(*) from ${schema.comment} c where c.post_id = ${p.id} and c.status = 'approved' and c.deleted_at is null)`,
    })
    .from(p)
    .where(
      and(
        eq(p.status, "published"),
        isNull(p.deletedAt),
        actor.role === "author" ? eq(p.authorId, actor.id) : undefined,
        term ? sql`${p.title} ilike ${`%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}` : undefined,
      ),
    )
    .orderBy(desc(p.publishedAt))
    .limit(100);
}

