import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import { getPublishedContent, invalidateContent } from "@/lib/content";
import { fidelity, isSafeUrl, parseMarkdown, serializeMarkdown } from "@/lib/editor/markdown";
import { markdownToHtml } from "@/lib/mdx/html";
import { rowToForm } from "@/lib/post-form";
import { ConflictError, createPost, duplicatePost, getPostRow, publishDuePosts, publishPost, restorePost, trashPost, updatePost, type Actor } from "@/lib/posts";
import { getAutosave, getRevision, listRevisions, saveAutosave } from "@/lib/revisions";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));

const admin: Actor = { id: "admin", role: "admin", label: "admin@example.com" };
const author: Actor = { id: "author", role: "author", label: "a@example.com" };
const other: Actor = { id: "other", role: "author", label: "o@example.com" };
const reader: Actor = { id: "reader", role: "user", label: "r@example.com" };

const base = {
  collection: "blog",
  slug: "a-fresh-post",
  title: "A fresh post written in the editor",
  description: "A description that is comfortably longer than fifty characters for the schema.",
  body: "## Hello\n\nBody text.",
  category: "kubernetes",
  tags: ["GitOps"],
  contentType: "tutorial",
  status: "draft",
};

let db: Db;
beforeEach(async () => {
  vi.stubEnv("CONTENT_DIR", "");
  delete process.env.CONTENT_DIR;
  db = await freshDb();
  for (const a of [admin, author, other, reader]) await db.insert(schema.user).values({ id: a.id, name: a.id, email: a.label, role: a.role });
  await db.insert(schema.authorProfile).values([
    { userId: "admin", slug: "jithendar-dharmapuri", displayName: "Admin" },
    { userId: "author", slug: "writer", displayName: "Writer" },
    { userId: "other", slug: "other-writer", displayName: "Other" },
  ]);
  invalidateContent();
});
afterEach(() => {
  vi.unstubAllEnvs();
  setDbForTests(undefined);
});

describe("content fidelity (Markdown is canonical)", () => {
  const root = path.resolve("content");
  const bodies = ["blog", "pages", "projects"].flatMap((dir) =>
    fs.existsSync(path.join(root, dir))
      ? fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".mdx")).map((f) => [`${dir}/${f}`, fs.readFileSync(path.join(root, dir, f), "utf8").replace(/^---[\s\S]*?---\n/, "")] as const)
      : [],
  );

  it.each(bodies)("opens existing content %s in the visual editor without loss", (_name, body) => {
    expect(fidelity(body)).toEqual({ lossless: true });
  });

  it("round-trips every supported block exactly", () => {
    const md = [
      "## Heading 2", "### Heading 3", "#### Heading 4", "##### Heading 5", "###### Heading 6",
      "Text with **bold**, *italic*, ~~strike~~, `code` and a [link](https://example.com).",
      "- one\n- two", "1. first\n2. second", "- [ ] open\n- [x] done", "> A quote", "---",
      "```yaml\nkey: value\n```",
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
      "![A diagram](/images/example.jpg)",
    ].join("\n\n");
    expect(fidelity(md)).toEqual({ lossless: true });
    expect(serializeMarkdown(parseMarkdown(md))).toContain("```yaml\nkey: value\n```");
  });

  it("keeps shortcodes, comments and raw HTML/JSX byte for byte as protected blocks", () => {
    const protectedSrc = [
      ':::callout{type="warning" title="Careful"}\nDo **not** run this in production.\n:::',
      ':::gallery{caption="Screens"}\n![One](/images/a.jpg) ![Two](/images/b.jpg)\n:::',
      '::embed{src="https://youtu.be/dQw4w9WgXcQ" title="Talk"}',
      "<!-- editor note: check numbers -->",
      "<Todo>Confirm the benchmark source.</Todo>",
      ":::unknown-widget{x=\"1\"}\nkept as-is\n:::",
    ];
    const md = ["Intro.", ...protectedSrc, "Outro."].join("\n\n");
    const doc = parseMarkdown(md);
    expect(doc.content!.filter((n) => n.type === "protectedBlock").map((n) => n.attrs!.source)).toEqual(protectedSrc);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it("reports (never silently drops) content the visual editor cannot represent", () => {
    const r = fidelity("Inline <kbd>Ctrl</kbd> and <span style=\"color:red\">styled</span> HTML.");
    expect(r.lossless).toBe(false);
  });
});

describe("unsafe links and stored XSS", () => {
  it("allows only http(s), mailto, site paths and anchors", () => {
    for (const ok of ["https://x.dev", "http://x.dev", "mailto:a@b.c", "/about", "#top"]) expect(isSafeUrl(ok)).toBe(true);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "vbscript:x", "//evil.example"]) expect(isSafeUrl(bad)).toBe(false);
  });

  it("refuses to save javascript:/data: links", async () => {
    await expect(createPost(author, { ...base, body: "[click](javascript:alert(document.cookie))" })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.stringContaining("scheme that is not allowed")]),
    });
  });

  it("never renders scripts or script URLs, even from content saved before validation existed", async () => {
    const html = await markdownToHtml('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![a](data:image/svg+xml,<svg onload=alert(1)>)');
    expect(html).not.toMatch(/<script|onerror|onload=|javascript:|data:image/i);
  });
});

describe("saving, autosave and concurrency", () => {
  it("autosaves a per-user working copy without touching the live post", async () => {
    const post = await createPost(author, { ...base, status: "draft" });
    const live = await publishPost(author, post.id, {});
    expect(live.status).toBe("published");
    await saveAutosave(author, "post", post.id, live.version, { ...rowToForm(live), body: "## Hello\n\nWork in progress." });

    const [published] = await getPublishedContent({ preview: false });
    expect(published!.body).toBe("## Hello\n\nBody text."); // readers still see the committed version
    expect((await getAutosave(author, "post", post.id))!.payload.body).toBe("## Hello\n\nWork in progress.");
    expect(await getAutosave(other, "post", post.id)).toBeNull(); // scoped to the user

    // "Update" commits it and clears the working copy.
    await updatePost(author, post.id, { body: "## Hello\n\nWork in progress." }, { baseVersion: live.version });
    invalidateContent();
    expect((await getPublishedContent({ preview: false }))[0]!.body).toBe("## Hello\n\nWork in progress.");
    expect(await getAutosave(author, "post", post.id)).toBeNull();
  });

  it("refuses to overwrite a newer save (another tab or editor)", async () => {
    const post = await createPost(author, base);
    await updatePost(admin, post.id, { title: "Edited by the admin in another tab" }, { baseVersion: post.version });
    const err = await updatePost(author, post.id, { title: "Stale edit from the first tab" }, { baseVersion: post.version }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.status).toBe(409);
    expect((await getPostRow(author, post.id)).title).toBe("Edited by the admin in another tab");
    // Deliberate overwrite with the latest version works and is recorded.
    const latest = await getPostRow(author, post.id);
    await updatePost(author, post.id, { title: "Stale edit from the first tab" }, { baseVersion: latest.version });
  });

  it("keeps every committed version and can restore an old one without deleting history", async () => {
    const post = await createPost(author, base);
    const v2 = await updatePost(author, post.id, { body: "## Hello\n\nSecond draft." });
    await updatePost(author, post.id, { body: "## Hello\n\nThird draft." }, { baseVersion: v2.version });
    const revs = await listRevisions("post", post.id);
    expect(revs.map((r) => r.version)).toEqual([3, 2, 1]);
    const first = await getRevision("post", post.id, revs[2]!.id);
    const restored = rowToForm(first.payload);
    expect(restored.body).toBe("## Hello\n\nBody text.");
    await updatePost(author, post.id, restored, { baseVersion: 3, reason: "restore" });
    expect((await listRevisions("post", post.id)).map((r) => r.reason)).toEqual(["restore", "save", "save", "create"]);
  });

  it("enforces permissions for editing, publishing and history", async () => {
    const post = await createPost(author, base);
    await expect(createPost(reader, base)).rejects.toMatchObject({ status: 403 });
    await expect(updatePost(other, post.id, { title: "Hijacked title for this post" })).rejects.toMatchObject({ status: 404 });
    await expect(publishPost(other, post.id, {})).rejects.toMatchObject({ status: 404 });
    await expect(getPostRow(other, post.id)).rejects.toMatchObject({ status: 404 });
    await expect(updatePost(admin, post.id, { title: "Admins may edit every post" })).resolves.toBeTruthy();
  });
});

describe("scheduling, trash and duplicates", () => {
  it("schedules in IST and the server publishes exactly once at that time", async () => {
    const post = await createPost(author, base);
    const now = new Date("2026-11-01T03:00:00Z");
    const scheduled = await publishPost(author, post.id, { publishedAt: "2026-11-01T09:00:00+05:30" }, {}, now);
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.publishedAt!.toISOString()).toBe("2026-11-01T03:30:00.000Z");
    expect(await getPublishedContent({ now: new Date("2026-11-02T00:00:00Z"), preview: false })).toHaveLength(0);

    expect(await publishDuePosts(new Date("2026-11-01T03:29:59Z"))).toEqual([]);
    expect(await publishDuePosts(new Date("2026-11-01T03:30:00Z"))).toEqual([post.id]);
    expect(await publishDuePosts(new Date("2026-11-01T03:31:00Z"))).toEqual([]); // idempotent: retries and other replicas do nothing
    const row = await getPostRow(author, post.id);
    expect(row.status).toBe("published");
    expect(row.publishedAt!.toISOString()).toBe("2026-11-01T03:30:00.000Z");
    expect((await listRevisions("post", post.id))[0]!.reason).toBe("scheduled-publish");
  });

  it("keeps the original publication date when republishing", async () => {
    const post = await createPost(author, { ...base, status: "draft", publishedAt: "2024-05-01T10:00:00+05:30" });
    const row = await publishPost(author, post.id, {});
    expect(row.publishedAt!.toISOString()).toBe("2024-05-01T04:30:00.000Z");
  });

  it("trash hides a post everywhere and restore brings it back; duplicates are new drafts with unique slugs", async () => {
    const post = await createPost(author, base);
    await publishPost(author, post.id, {});
    invalidateContent();
    expect(await getPublishedContent({ preview: false })).toHaveLength(1);
    await trashPost(author, post.id);
    invalidateContent();
    expect(await getPublishedContent({ preview: false })).toHaveLength(0);
    await expect(updatePost(author, post.id, { title: "Editing a trashed post is refused" })).rejects.toMatchObject({ status: 409 });
    await restorePost(author, post.id);
    invalidateContent();
    expect(await getPublishedContent({ preview: false })).toHaveLength(1);

    const a = await duplicatePost(other, post.id).catch((e) => e);
    expect(a.status).toBe(404); // cannot copy someone else's post
    const copy1 = await duplicatePost(author, post.id);
    const copy2 = await duplicatePost(author, post.id);
    expect([copy1.slug, copy2.slug]).toEqual(["a-fresh-post-copy", "a-fresh-post-copy-2"]);
    expect(copy1).toMatchObject({ status: "draft", publishedAt: null, authorId: "author" });
    const [orig] = await db.select().from(schema.post).where(eq(schema.post.id, post.id));
    expect(orig!.status).toBe("published");
  });
});
