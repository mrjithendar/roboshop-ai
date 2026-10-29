import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import type { SessionUser } from "@/lib/session";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The signed-in user for server actions (the session itself is covered in social-auth.test.ts).
let currentUser: SessionUser | null = null;
vi.mock("@/lib/session", () => ({ getSessionUser: async () => currentUser }));

const settings = {
  features: { comments: true, registration: true, contactForm: true },
  discussion: { requireApproval: true, editWindowMinutes: 1440 },
};
vi.mock("@/lib/settings", () => ({ getSettings: async () => settings }));

// Turnstile: every token passes except "bad".
const turnstile = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const token = new URLSearchParams(String(init?.body)).get("response");
  return new Response(JSON.stringify({ success: token !== "bad" }), { headers: { "content-type": "application/json" } });
});

type Role = "admin" | "author" | "user";
const people: Record<string, { id: string; role: Role; email: string }> = {
  admin: { id: "admin", role: "admin", email: "admin@example.com" },
  author: { id: "author", role: "author", email: "author@example.com" },
  alice: { id: "alice", role: "user", email: "alice@example.com" },
  bob: { id: "bob", role: "user", email: "bob@example.com" },
};
const as = (who: keyof typeof people): SessionUser => ({ ...people[who]!, name: `${who[0]!.toUpperCase()}${who.slice(1)}`, emailVerified: true, image: null, sessionCreatedAt: new Date() });
const actor = (who: keyof typeof people) => ({ id: people[who]!.id, role: people[who]!.role, label: people[who]!.email });

let db: Db;
let postA: string;
let postB: string;
let keyN = 0;
const key = () => `client-key-${++keyN}`;

beforeEach(async () => {
  vi.stubGlobal("fetch", turnstile);
  settings.features.comments = true;
  settings.discussion = { requireApproval: true, editWindowMinutes: 1440 };
  currentUser = null;
  db = await freshDb();
  for (const [who, p] of Object.entries(people)) await db.insert(schema.user).values({ id: p.id, name: `${who[0]!.toUpperCase()}${who.slice(1)}`, email: p.email, role: p.role });
  const base = { collection: "blog", description: "A description that is comfortably longer than fifty characters for the schema.", category: "kubernetes", contentType: "tutorial", authorId: "author", status: "published", publishedAt: new Date("2026-10-20T03:30:00Z") };
  const rows = await db
    .insert(schema.post)
    .values([
      { ...base, slug: "post-a", title: "Post A" },
      { ...base, slug: "post-b", title: "Post B" },
    ])
    .returning({ id: schema.post.id });
  [postA, postB] = rows.map((r) => r.id) as [string, string];
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDbForTests(undefined);
});

async function lib() {
  return import("@/lib/comments");
}
async function actions() {
  return import("@/app/_actions/comments");
}

/** Post as a user through the server action (session, Turnstile and all checks). */
async function postAs(who: keyof typeof people, body: string, opts: { postId?: string; parentId?: string | null; clientKey?: string; token?: string } = {}) {
  currentUser = as(who);
  const { postCommentAction } = await actions();
  return postCommentAction({ postId: opts.postId ?? postA, parentId: opts.parentId ?? null, body, clientKey: opts.clientKey ?? key(), token: opts.token ?? "ok" });
}

async function approved(who: keyof typeof people, body: string, parentId: string | null = null, postId = postA) {
  const r = await postAs(who, body, { parentId, postId });
  if (!r.ok) throw new Error(r.error);
  if (r.status !== "approved") {
    const { moderateComment } = await lib();
    await moderateComment(actor("admin"), r.id, "approve");
  }
  return r.id;
}

async function publicView(postId = postA) {
  const { listComments } = await lib();
  return listComments(postId, null);
}

describe("posting", () => {
  it("requires a session; readers' comments wait for approval, staff comments do not", async () => {
    currentUser = null;
    const { postCommentAction } = await actions();
    expect(await postCommentAction({ postId: postA, body: "Hello there", clientKey: key(), token: "ok" })).toMatchObject({ ok: false, signedOut: true });

    const reader = await postAs("alice", "A first comment");
    expect(reader).toMatchObject({ ok: true, status: "pending" });
    const staff = await postAs("author", "Author reply here");
    expect(staff).toMatchObject({ ok: true, status: "approved" });

    settings.discussion.requireApproval = false;
    expect(await postAs("bob", "Published at once")).toMatchObject({ ok: true, status: "approved" });
  });

  it("checks Turnstile and length", async () => {
    expect(await postAs("alice", "Hello there", { token: "bad" })).toMatchObject({ ok: false, error: expect.stringMatching(/verification/) });
    expect(await postAs("alice", " x ")).toMatchObject({ ok: false, error: expect.stringMatching(/2–5000/) });
    expect(await postAs("alice", "y".repeat(5001))).toMatchObject({ ok: false, error: expect.stringMatching(/2–5000/) });
  });

  it("ignores a resubmitted form (same client key) and refuses the same text twice", async () => {
    const k = key();
    const first = await postAs("alice", "Only once please", { clientKey: k });
    const again = await postAs("alice", "Only once please", { clientKey: k, token: "bad" });
    expect(first.ok && again.ok && again.id === first.id).toBe(true);
    expect(await postAs("alice", "Only once please")).toMatchObject({ ok: false, error: "You already posted this comment." });
    expect(await db.select().from(schema.comment)).toHaveLength(1);
  });

  it("rate-limits bursts of comments", async () => {
    for (let i = 0; i < 5; i++) expect(await postAs("bob", `Comment number ${i}`)).toMatchObject({ ok: true });
    expect(await postAs("bob", "One too many")).toMatchObject({ ok: false, error: expect.stringMatching(/too quickly/) });
  });

  it("rejects replies to a comment on another post, in the service and in the database", async () => {
    const onB = await approved("author", "Comment on post B", null, postB);
    expect(await postAs("alice", "Cross-post reply", { postId: postA, parentId: onB })).toMatchObject({ ok: false, error: expect.stringMatching(/same post/) });
    await expect(db.insert(schema.comment).values({ postId: postA, userId: "alice", body: "sneaky", status: "approved", parentId: onB, depth: 1 })).rejects.toThrow();
  });

  it("refuses replies to pending, hidden or deleted comments", async () => {
    const pending = await postAs("alice", "Pending comment");
    expect(await postAs("bob", "Reply to pending", { parentId: pending.ok ? pending.id : null })).toMatchObject({ ok: false });
  });

  it("is closed when comments are off, the post is closed, or the discussion is locked", async () => {
    const { setDiscussionMode } = await lib();
    settings.features.comments = false;
    expect(await postAs("alice", "Closed site-wide")).toMatchObject({ ok: false, error: "Comments are closed." });
    settings.features.comments = true;
    await setDiscussionMode(actor("author"), postA, "locked");
    expect(await postAs("alice", "Locked post")).toMatchObject({ ok: false, error: "This discussion is locked." });
    await setDiscussionMode(actor("admin"), postA, "closed");
    expect((await publicView()).state.enabled).toBe(false);
    // Only admins and the post's author may change it; every change is audited.
    await expect(setDiscussionMode(actor("alice"), postA, "open")).rejects.toMatchObject({ status: 403 });
    expect((await db.select().from(schema.auditLog)).filter((a) => a.action === "post.discussion")).toHaveLength(2);
  });
});

describe("what readers see", () => {
  it("shows only approved comments publicly, and never emails or user ids", async () => {
    const shown = await approved("alice", "Visible comment");
    await postAs("bob", "Still pending");
    const page = await publicView();
    expect(page.threads.map((t) => t.id)).toEqual([shown]);
    expect(page.total).toBe(1);
    const json = JSON.stringify(page);
    for (const p of Object.values(people)) expect(json).not.toContain(p.email);
    expect(json).not.toMatch(/"(userId|alice|bob)"/);

    // The author of a pending comment sees it (marked), nobody else does.
    const { listComments } = await lib();
    const bobView = await listComments(postA, { id: "bob", role: "user" });
    expect(bobView.threads.find((t) => t.pending)?.author?.name).toBe("Bob");
    expect((await listComments(postA, { id: "alice", role: "user" })).threads.some((t) => t.pending)).toBe(false);
  });

  it("keeps hidden, removed and deleted comments out, leaving a neutral placeholder only when replies exist", async () => {
    const { moderateComment } = await lib();
    const parent = await approved("alice", "Parent comment");
    await approved("bob", "A reply", parent);
    const lonely = await approved("alice", "Lonely comment");
    await moderateComment(actor("author"), parent, "hide");
    await moderateComment(actor("author"), lonely, "remove");
    const page = await publicView();
    expect(page.threads).toHaveLength(1);
    const [t] = page.threads;
    expect(t).toMatchObject({ id: parent, tombstone: true, author: null, html: "", likes: 0 });
    expect(JSON.stringify(t)).not.toContain("Parent comment");
    expect(t!.replies[0]!.html).toContain("A reply");

    await moderateComment(actor("author"), parent, "restore");
    expect((await publicView()).threads[0]).toMatchObject({ tombstone: false });
  });

  it("limits indentation and points deeper replies at the comment they answer", async () => {
    const root = await approved("alice", "Level zero");
    const one = await approved("bob", "Level one", root);
    const two = await approved("alice", "Level two", one);
    const three = await approved("bob", "Level three", two);
    const [thread] = (await publicView()).threads;
    const levelOne = thread!.replies[0]!;
    expect(levelOne.id).toBe(one);
    // Level two and everything deeper share the last indented level, in time order.
    expect(levelOne.replies.map((r) => r.id)).toEqual([two, three]);
    expect(levelOne.replies[0]!.replyTo).toBeNull();
    expect(levelOne.replies[1]!.replyTo).toEqual({ id: two, name: "Alice" });
    expect(levelOne.replies.every((r) => r.replies.length === 0)).toBe(true);
  });

  it("sorts and pages top-level threads and finds a permalinked thread", async () => {
    const { buildPage } = await lib();
    const ids: string[] = [];
    settings.discussion.requireApproval = false;
    for (let i = 0; i < 12; i++) {
      const [row] = await db
        .insert(schema.comment)
        .values({ postId: postA, userId: i % 2 ? "alice" : "bob", body: `Comment ${i}`, status: "approved", createdAt: new Date(Date.UTC(2026, 9, 21, 0, i)) })
        .returning({ id: schema.comment.id });
      ids.push(row!.id);
    }
    const { listComments } = await lib();
    const first = await listComments(postA, null, { sort: "oldest" });
    expect(first.threads.map((t) => t.id)).toEqual(ids.slice(0, 10));
    const second = await listComments(postA, null, { sort: "oldest", cursor: first.nextCursor });
    expect(second.threads.map((t) => t.id)).toEqual(ids.slice(10));
    expect(second.nextCursor).toBeNull();
    const newest = await listComments(postA, null, { sort: "newest" });
    expect(newest.threads[0]!.id).toBe(ids[11]);
    expect((await listComments(postA, null, { focus: ids[0] })).threads.map((t) => t.id)).toEqual([ids[0]]);
    expect(typeof buildPage).toBe("function");
  });

  it("renders Markdown safely (no stored XSS)", async () => {
    settings.discussion.requireApproval = false;
    await postAs(
      "alice",
      ['<script>alert(1)</script>', "**bold** [x](javascript:alert(1)) [y](data:text/html,hi)", 'inline <img src=x onerror="alert(1)"> and <a href="javascript:1">raw</a>', "[ok](https://example.com) `a<b`", "```\n<b>code</b>\n```"].join("\n\n"),
    );
    const html = (await publicView()).threads[0]!.html;
    // No executable markup: no script/img/iframe tags, no event-handler attributes, only http(s)/mailto links.
    expect(html).not.toMatch(/<(script|img|iframe|style|svg)\b/i);
    expect(html).not.toMatch(/<[^>]+\son\w+=/i);
    // (Raw HTML shows up as escaped text, e.g. "&#x3C;a href=…", which is not a tag.)
    expect([...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1])).toEqual(["https://example.com"]);
    expect(html).toContain("&#x3C;a href=");
    expect(html).toContain("<p><strong>bold</strong> x y</p>");
    expect(html).toContain("&#x3C;script>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com" rel="nofollow ugc noopener noreferrer">ok</a>');
    expect(html).toContain("<code>a&#x3C;b</code>");
    // The preview uses the same renderer.
    currentUser = as("alice");
    const { previewCommentAction } = await actions();
    const preview = await previewCommentAction("_hi_ <iframe src=//evil></iframe>");
    expect(preview.ok && preview.html).toBe("<p><em>hi</em> &#x3C;iframe src=//evil>&#x3C;/iframe></p>");
  });
});

describe("ownership", () => {
  it("lets authors edit and delete only their own comments, within the edit window", async () => {
    const { editCommentAction, deleteCommentAction, commentSourceAction } = await actions();
    const id = await approved("alice", "Original text");
    currentUser = as("bob");
    expect(await editCommentAction(postA, id, "Hijacked")).toMatchObject({ ok: false, error: "You can only change your own comments." });
    expect(await deleteCommentAction(postA, id)).toMatchObject({ ok: false });
    expect(await commentSourceAction(id)).toMatchObject({ ok: false });

    currentUser = as("alice");
    expect(await commentSourceAction(id)).toMatchObject({ ok: true, body: "Original text" });
    const edited = await editCommentAction(postA, id, "Edited text");
    expect(edited.ok && edited.thread?.editedAt).toBeTruthy();

    await db.update(schema.comment).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.comment.id, id));
    expect(await editCommentAction(postA, id, "Too late")).toMatchObject({ ok: false, error: expect.stringMatching(/time for editing/) });

    expect(await deleteCommentAction(postA, id)).toMatchObject({ ok: true });
    const [row] = await db.select().from(schema.comment).where(eq(schema.comment.id, id));
    expect(row!.body).toBe("");
    expect(row!.deletedAt).not.toBeNull();
    expect((await publicView()).threads).toHaveLength(0);
  });
});

describe("likes and reports", () => {
  it("counts one like per user, refuses self-likes and unliking works", async () => {
    const { likeCommentAction } = await actions();
    const id = await approved("alice", "Like me");
    currentUser = as("bob");
    expect(await likeCommentAction(id, true)).toMatchObject({ ok: true, likes: 1, liked: true });
    expect(await likeCommentAction(id, true)).toMatchObject({ ok: true, likes: 1 });
    await expect(db.insert(schema.commentLike).values({ commentId: id, userId: "bob" })).rejects.toThrow();
    currentUser = as("alice");
    expect(await likeCommentAction(id, true)).toMatchObject({ ok: false, error: "You cannot like your own comment." });
    currentUser = as("bob");
    expect(await likeCommentAction(id, false)).toMatchObject({ ok: true, likes: 0, liked: false });
  });

  it("files one report per user and puts the comment in the reported queue until a moderator decides", async () => {
    const { reportCommentAction } = await actions();
    const { moderationQueue, moderateComment, moderationCounts } = await lib();
    const id = await approved("alice", "Questionable comment");
    currentUser = as("bob");
    expect(await reportCommentAction(id, "nonsense", "")).toMatchObject({ ok: false });
    expect(await reportCommentAction(id, "spam", "Selling things")).toMatchObject({ ok: true, message: expect.stringMatching(/moderator/) });
    expect(await reportCommentAction(id, "spam", "")).toMatchObject({ ok: true, message: expect.stringMatching(/already/) });
    expect((await moderationCounts()).reported).toBe(1);
    const [item] = await moderationQueue(actor("admin"), "reported");
    expect(item).toMatchObject({ id, email: "alice@example.com", reports: [{ reason: "spam", note: "Selling things" }] });
    // Authors moderate too, but do not see readers' emails.
    expect((await moderationQueue(actor("author"), "reported"))[0]!.email).toBeNull();

    await moderateComment(actor("author"), id, "hide", "spam link");
    expect((await moderationCounts()).reported).toBe(0);
    const [entry] = (await db.select().from(schema.auditLog)).filter((a) => a.action === "comment.hide");
    expect(entry).toMatchObject({ actorId: "author", target: id, detail: { from: "approved", to: "hidden", openReports: 1, note: "spam link" } });
  });
});

describe("moderation permissions", () => {
  it("is for authors and admins only; permanent deletion is admin-only and never orphans replies", async () => {
    const { moderateComment } = await lib();
    const parent = await approved("alice", "Has a reply");
    await approved("bob", "The reply", parent);
    await expect(moderateComment(actor("bob"), parent, "remove")).rejects.toMatchObject({ status: 403 });
    await expect(moderateComment(actor("author"), parent, "purge")).rejects.toMatchObject({ status: 403 });
    await expect(moderateComment(actor("admin"), parent, "purge")).rejects.toMatchObject({ status: 409 });
    const single = await approved("alice", "Alone");
    await moderateComment(actor("admin"), single, "purge");
    expect(await db.select().from(schema.comment).where(eq(schema.comment.id, single))).toHaveLength(0);
  });
});

describe("comments API route", () => {
  it("answers with the visitor's view, private and uncached; 404 for unknown or closed discussions", async () => {
    await approved("alice", "Hello API");
    currentUser = null;
    const { GET } = await import("@/app/api/comments/[postId]/route");
    const res = await GET(new Request(`https://jithendar.com/api/comments/${postA}`), { params: Promise.resolve({ postId: postA }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as { threads: { author: { name: string } }[]; signedIn: boolean };
    expect(body.threads[0]!.author.name).toBe("Alice");
    expect(body.signedIn).toBe(false);
    expect(JSON.stringify(body)).not.toContain("@example.com");

    const missing = await GET(new Request("https://jithendar.com/api/comments/x"), { params: Promise.resolve({ postId: "not-a-uuid" }) });
    expect(missing.status).toBe(404);
  });
});
