import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import { invalidateContent } from "@/lib/content";
import { importFromFiles } from "@/lib/content/import";
import { createPost, deletePost, PostError, updatePost, type Actor } from "@/lib/posts";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));

const admin: Actor = { id: "admin", role: "admin", label: "admin@example.com" };
const author: Actor = { id: "author", role: "author", label: "author@example.com" };
const reader: Actor = { id: "reader", role: "user", label: "reader@example.com" };

const valid = {
  collection: "blog",
  slug: "a-fresh-post",
  title: "A fresh post written in the admin",
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
  for (const [id, role] of [["admin", "admin"], ["author", "author"], ["reader", "user"]] as const) {
    await db.insert(schema.user).values({ id, name: id, email: `${id}@example.com`, role });
  }
  await db.insert(schema.authorProfile).values([
    { userId: "admin", slug: "jithendar-dharmapuri", displayName: "Admin" },
    { userId: "author", slug: "writer", displayName: "Writer" },
  ]);
  invalidateContent();
});
afterEach(() => {
  vi.unstubAllEnvs();
  setDbForTests(undefined);
});

describe("post service", () => {
  it("creates a draft and publishes it", async () => {
    const created = await createPost(admin, valid);
    expect(created.status).toBe("draft");
    const published = await updatePost(admin, created.id, { status: "published", publishedAt: "2026-10-27T18:00:00+05:30" });
    expect(published.status).toBe("published");
    expect(published.body).toBe(valid.body);
  });

  it("publishes the imported drafts (the bulk Publish path)", async () => {
    await importFromFiles(db, path.resolve(import.meta.dirname, "../content"), new Map([["jithendar-dharmapuri", "admin"]]));
    const drafts = await db.select().from(schema.post);
    expect(drafts.length).toBeGreaterThan(0);
    for (const row of drafts) {
      const out = await updatePost(admin, row.id, { status: "published", publishedAt: new Date().toISOString() });
      expect(out.status).toBe("published");
    }
  });

  it("lets authors publish their own posts but not touch others'", async () => {
    const mine = await createPost(author, { ...valid, slug: "authors-post" });
    expect((await updatePost(author, mine.id, { status: "published", publishedAt: "2026-10-27T18:00:00+05:30" })).status).toBe("published");
    const theirs = await createPost(admin, valid);
    await expect(updatePost(author, theirs.id, { title: "Hijacked title for a test" })).rejects.toBeInstanceOf(PostError);
    await expect(createPost(reader, valid)).rejects.toMatchObject({ status: 403 });
  });

  it("reports invalid fields, duplicate slugs and unknown categories clearly", async () => {
    await expect(createPost(admin, { ...valid, title: "Short" })).rejects.toMatchObject({ issues: expect.arrayContaining([expect.stringMatching(/^title:/)]) });
    await expect(createPost(admin, { ...valid, category: "gardening" })).rejects.toMatchObject({ issues: expect.arrayContaining([expect.stringMatching(/category/)]) });
    await createPost(admin, valid);
    await expect(createPost(admin, valid)).rejects.toMatchObject({ status: 409 });
  });

  it("records a redirect when a slug changes, and deletes", async () => {
    const p = await createPost(admin, valid);
    await updatePost(admin, p.id, { slug: "a-renamed-post" });
    const [r] = await db.select().from(schema.redirect).where(eq(schema.redirect.fromPath, "/blog/a-fresh-post"));
    expect(r?.toPath).toBe("/blog/a-renamed-post");
    await deletePost(admin, p.id);
    expect(await db.select().from(schema.post)).toHaveLength(0);
  });
});
