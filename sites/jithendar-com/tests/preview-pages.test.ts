import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import { invalidateContent } from "@/lib/content";
import type { Actor } from "@/lib/posts";
import { createPreview, readPreview } from "@/lib/preview";
import { deletePage, savePage, trashPage } from "@/lib/site-pages";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));

const admin: Actor = { id: "admin", role: "admin", label: "admin@example.com" };
const author: Actor = { id: "author", role: "author", label: "author@example.com" };
const other: Actor = { id: "other", role: "author", label: "other@example.com" };
const reader: Actor = { id: "reader", role: "user", label: "reader@example.com" };

let db: Db;
beforeEach(async () => {
  vi.stubEnv("CONTENT_DIR", "");
  delete process.env.CONTENT_DIR;
  db = await freshDb();
  for (const a of [admin, author, other, reader]) await db.insert(schema.user).values({ id: a.id, name: a.id, email: a.label, role: a.role });
  invalidateContent();
});
afterEach(() => {
  vi.unstubAllEnvs();
  setDbForTests(undefined);
});

describe("previews", () => {
  it("are readable by their creator and by admins, not by other authors", async () => {
    const token = await createPreview(author, "post", { title: "Draft" });
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await readPreview(author, token))?.payload).toEqual({ title: "Draft" });
    expect(await readPreview(admin, token)).not.toBeNull();
    expect(await readPreview(other, token)).toBeNull();
  });

  it("refuse readers, malformed tokens, expired previews and oversized payloads", async () => {
    await expect(createPreview(reader, "post", {})).rejects.toMatchObject({ status: 403 });
    expect(await readPreview(admin, "../../etc/passwd")).toBeNull();
    const token = await createPreview(author, "page", { title: "Old" });
    await db.update(schema.preview).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.preview.token, token));
    expect(await readPreview(author, token)).toBeNull();
    await expect(createPreview(author, "post", { body: "x".repeat(500_000) })).rejects.toMatchObject({ status: 400 });
  });
});

describe("page service", () => {
  const page = { slug: "about-me", title: "About me", description: "A description that is comfortably longer than fifty characters for pages.", body: "Hello" };

  it("creates, renames with a redirect, trashes and deletes pages", async () => {
    expect((await savePage(author, null, page)).slug).toBe("about-me");
    await savePage(author, "about-me", { ...page, slug: "about" });
    const [moved] = await db.select().from(schema.redirect).where(eq(schema.redirect.fromPath, "/about-me"));
    expect(moved?.toPath).toBe("/about");
    await expect(deletePage(admin, "about")).rejects.toMatchObject({ status: 409 });
    await trashPage(admin, "about");
    await deletePage(admin, "about");
    expect(await db.select().from(schema.page)).toHaveLength(0);
  });

  it("refuses reserved slugs, duplicates and readers", async () => {
    await expect(savePage(admin, null, { ...page, slug: "admin" })).rejects.toMatchObject({ issues: expect.arrayContaining([expect.stringMatching(/reserved/)]) });
    await savePage(admin, null, page);
    await expect(savePage(admin, null, page)).rejects.toMatchObject({ status: 409 });
    await expect(savePage(reader, null, { ...page, slug: "x-page" })).rejects.toMatchObject({ status: 403 });
  });
});
