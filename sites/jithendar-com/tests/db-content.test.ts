import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests } from "@/db";
import { getAuthor, getPage, getPublishedArticle, getPublishedContent, invalidateContent } from "@/lib/content";
import { freshDb } from "./db-helpers";

const NOW = new Date("2026-10-27T12:00:00Z");

async function seed() {
  const db = await freshDb();
  await db.insert(schema.user).values({ id: "u1", name: "Writer", email: "w@example.com", role: "author" });
  await db.insert(schema.authorProfile).values({ userId: "u1", slug: "writer", displayName: "Writer", sameAs: ["https://github.com/example"] });
  const base = {
    collection: "blog",
    description: "A description that is comfortably longer than fifty characters for the schema.",
    category: "kubernetes",
    contentType: "tutorial",
    authorId: "u1",
    body: "## Hello\n\nBody",
  };
  await db.insert(schema.post).values([
    { ...base, slug: "live-post", title: "A live published post", status: "published", publishedAt: new Date("2026-10-20T03:30:00Z"), tags: ["GitOps"] },
    { ...base, slug: "draft-post", title: "A draft post in the DB", status: "draft" },
    { ...base, slug: "future-post", title: "A future post in the DB", status: "published", publishedAt: new Date("2026-11-01T00:00:00Z") },
    { ...base, slug: "review-post", title: "A post waiting in review", status: "review" },
    { ...base, slug: "Bad Slug", title: "Invalid row is skipped", status: "published", publishedAt: new Date("2026-10-20T00:00:00Z") },
  ]);
  await db.insert(schema.page).values({ slug: "about", title: "About", description: "A description that is comfortably longer than fifty characters for pages.", body: "Hi" });
  invalidateContent();
}

beforeEach(async () => {
  vi.stubEnv("CONTENT_DIR", "");
  delete process.env.CONTENT_DIR;
  vi.spyOn(console, "error").mockImplementation(() => {});
  await seed();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setDbForTests(undefined);
  invalidateContent();
});

describe("Postgres content source", () => {
  it("serves only published, past items through the same gate", async () => {
    const slugs = (await getPublishedContent({ now: NOW, preview: false })).map((a) => a.slug);
    expect(slugs).toEqual(["live-post"]);
    expect(await getPublishedArticle("blog", "draft-post", { now: NOW, preview: false })).toBeUndefined();
  });

  it("emits timestamps as ISO 8601 with the editorial offset", async () => {
    const [live] = await getPublishedContent({ now: NOW, preview: false });
    expect(live!.frontmatter.publishedAt).toBe("2026-10-20T09:00:00+05:30");
    expect(live!.frontmatter.tags).toEqual(["gitops"]);
    expect(live!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("skips rows that fail validation instead of breaking the site", async () => {
    const all = await getPublishedContent({ now: NOW, preview: false });
    expect(all.some((a) => a.slug === "Bad Slug")).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"msg":"invalid post skipped"'));
  });

  it("loads authors and pages", async () => {
    expect((await getAuthor("writer"))?.frontmatter.sameAs).toEqual(["https://github.com/example"]);
    expect((await getPage("about"))?.path).toBe("/about");
  });
});

describe("fresh installation", () => {
  it("serves the bundled content while the database is still empty", async () => {
    await freshDb();
    invalidateContent();
    vi.stubEnv("CONTENT_DIR", "");
    delete process.env.CONTENT_DIR;
    const page = await getPage("about");
    expect(page?.file).not.toMatch(/^db:/);
    expect(page?.frontmatter.title).toBeTruthy();
  });
});
