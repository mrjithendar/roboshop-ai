import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import { authenticateApiKey, createApiKey, revokeApiKey } from "@/lib/api-keys";
import { invalidateContent } from "@/lib/content";
import type { Actor } from "@/lib/posts";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
const author: Actor = { id: "author", role: "author", label: "a@example.com" };

let db: Db;
beforeEach(async () => {
  vi.stubEnv("CONTENT_DIR", "");
  delete process.env.CONTENT_DIR;
  db = await freshDb();
  await db.insert(schema.user).values({ id: "author", name: "A", email: "a@example.com", role: "author" });
  await db.insert(schema.authorProfile).values({ userId: "author", slug: "writer", displayName: "A" });
  invalidateContent();
});
afterEach(() => {
  vi.unstubAllEnvs();
  setDbForTests(undefined);
});

describe("API keys", () => {
  it("stores only a hash and authenticates as the owner with the key's scopes", async () => {
    const { key, id } = await createApiKey(author, { name: "n8n", scopes: ["posts:read", "posts:write"] });
    expect(key).toMatch(/^jk_[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(schema.apiKey).where(eq(schema.apiKey.id, id));
    expect(row!.hash).not.toContain(key);
    expect(JSON.stringify(row)).not.toContain(key.slice(11));
    const auth = await authenticateApiKey(`Bearer ${key}`);
    expect(auth.actor).toMatchObject({ id: "author", role: "author" });
    expect(auth.scopes).toEqual(["posts:read", "posts:write"]);
  });

  it("rejects malformed, revoked, expired keys and banned owners", async () => {
    await expect(authenticateApiKey(null)).rejects.toMatchObject({ status: 403 });
    await expect(authenticateApiKey("Bearer jk_not-a-real-key-at-all-xxxxxxxx")).rejects.toMatchObject({ status: 403 });
    const a = await createApiKey(author, { name: "one", scopes: ["posts:read"] });
    await revokeApiKey(author, a.id);
    await expect(authenticateApiKey(`Bearer ${a.key}`)).rejects.toMatchObject({ status: 403 });
    const b = await createApiKey(author, { name: "two", scopes: ["posts:read"] });
    await db.update(schema.apiKey).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.apiKey.id, b.id));
    await expect(authenticateApiKey(`Bearer ${b.key}`)).rejects.toMatchObject({ status: 403 });
    const c = await createApiKey(author, { name: "three", scopes: ["posts:read"] });
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, "author"));
    await expect(authenticateApiKey(`Bearer ${c.key}`)).rejects.toMatchObject({ status: 403 });
  });

  it("drives the posts API end to end: create, read, update, delete, scope checks", async () => {
    const { POST, GET } = await import("@/app/api/v1/posts/route");
    const item = await import("@/app/api/v1/posts/[id]/route");
    const rw = (await createApiKey(author, { name: "rw", scopes: ["posts:read", "posts:write"] })).key;
    const ro = (await createApiKey(author, { name: "ro", scopes: ["posts:read"] })).key;
    const req = (url: string, key: string, init: RequestInit = {}) =>
      new Request(`https://jithendar.com${url}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers } });
    const body = {
      collection: "blog", slug: "api-post", title: "A post created through the API", category: "kubernetes", contentType: "tutorial",
      description: "A description that is comfortably longer than fifty characters for the schema.", body: "## Hi", status: "draft",
    };
    expect((await POST(req("/api/v1/posts", ro, { method: "POST", body: JSON.stringify(body) }))).status).toBe(403);
    const created = await POST(req("/api/v1/posts", rw, { method: "POST", body: JSON.stringify(body) }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string; status: string } };
    const ctx = { params: Promise.resolve({ id: data.id }) };
    const patched = await item.PATCH(req(`/api/v1/posts/${data.id}`, rw, { method: "PATCH", body: JSON.stringify({ status: "published", publishedAt: "2026-10-27T18:00:00+05:30" }) }), ctx);
    expect(((await patched.json()) as { data: { status: string; publishedAt: string } }).data).toMatchObject({ status: "published", publishedAt: "2026-10-27T18:00:00+05:30" });
    const listed = (await (await GET(req("/api/v1/posts?status=published", ro))).json()) as { data: unknown[] };
    expect(listed.data).toHaveLength(1);
    const bad = await POST(req("/api/v1/posts", rw, { method: "POST", body: JSON.stringify({ ...body, slug: "x", title: "Short" }) }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { issues: string[] } }).error.issues.length).toBeGreaterThan(0);
    expect((await item.DELETE(req(`/api/v1/posts/${data.id}`, rw, { method: "DELETE" }), ctx)).status).toBe(204);
  });
});
