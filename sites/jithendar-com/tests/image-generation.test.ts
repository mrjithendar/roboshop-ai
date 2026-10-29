import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import type { Actor } from "@/lib/posts";
import { fakeR2, JPEG_1x1 } from "./fake-r2";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
const r2 = fakeR2();
vi.mock("@/lib/storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/storage")>()), ...r2 }));
const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; email: string; role: string; emailVerified: boolean } }));
vi.mock("@/lib/session", () => ({ getSessionUser: async () => session.user }));

const { generateImage, geminiImageConfig, ImageGenError } = await import("@/lib/gemini");
const { acceptGeneration, discardGeneration, expireGenerations, startGeneration } = await import("@/lib/image-generation");
const { createPost, getPostRow } = await import("@/lib/posts");
const { POST: generateRoute } = await import("@/app/api/admin/images/generate/route");

const admin: Actor = { id: "admin", role: "admin", label: "admin@example.com" };
const author: Actor = { id: "author", role: "author", label: "a@example.com" };
const other: Actor = { id: "other", role: "author", label: "o@example.com" };
const reader: Actor = { id: "reader", role: "user", label: "r@example.com" };

const config = { apiKey: "test-gemini-key", model: "configured-image-model", imageSize: "1K" as const, timeoutMs: 2_000, endpoint: "https://gemini.test/v1beta/interactions" };
const limits = { perUserHourly: 3, dailyTotal: 100, perUserConcurrent: 1 };
const PROMPT = "Editorial illustration of Kubernetes pods on a server rack, flat style";

/** A canned Interactions API response. */
const interaction = (content: unknown[], extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ id: "int-1", status: "completed", steps: [{ type: "user_input" }, { type: "model_output", content }], ...extra }), { status: 200, headers: { "Content-Type": "application/json" } });
const imageReply = (bytes = JPEG_1x1) => interaction([{ type: "text", text: "Here you go" }, { type: "image", mime_type: "image/jpeg", data: bytes.toString("base64") }]);
const fetchReturning = (res: () => Response) => vi.fn<typeof fetch>(async () => res());

let db: Db;
beforeEach(async () => {
  r2.objects.clear();
  session.user = null;
  db = await freshDb();
  for (const a of [admin, author, other, reader]) await db.insert(schema.user).values({ id: a.id, name: a.id, email: a.label, role: a.role });
});
afterEach(() => setDbForTests(undefined));

describe("Gemini client", () => {
  it("is off unless both the key and a model are configured (no built-in model name)", () => {
    expect(geminiImageConfig({ GEMINI_API_KEY: "k" })).toBeNull();
    expect(geminiImageConfig({ GEMINI_IMAGE_MODEL: "m" })).toBeNull();
    expect(geminiImageConfig({ GEMINI_API_KEY: "k", GEMINI_IMAGE_MODEL: "m", GEMINI_IMAGE_TIMEOUT_MS: "1" })).toMatchObject({ model: "m", imageSize: "1K", timeoutMs: 5_000 });
  });

  it("sends the documented Interactions request with the key in a header and storage disabled", async () => {
    const f = fetchReturning(() => imageReply());
    const out = await generateImage(config, { prompt: PROMPT, aspectRatio: "16:9" }, f);
    expect(out.bytes.equals(JPEG_1x1)).toBe(true);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(config.endpoint);
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-gemini-key");
    expect(String(url)).not.toContain("test-gemini-key");
    expect(JSON.parse(String(init!.body))).toEqual({
      model: "configured-image-model",
      input: PROMPT,
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "1K" },
      store: false,
    });
  });

  it.each([
    ["a content-policy failure", () => new Response(JSON.stringify({ id: "x", status: "failed", steps: [], errors: [{ code: "safety", message: "Blocked by safety filters" }] })), "refused"],
    ["a 400 safety block", () => new Response(JSON.stringify({ error: { message: "Request blocked: responsible AI policy" } }), { status: 400 }), "refused"],
    ["a text-only refusal", () => interaction([{ type: "text", text: "I can't create that image because it violates the safety policy." }]), "refused"],
    ["quota exhaustion", () => new Response(JSON.stringify({ error: { message: "Resource has been exhausted" } }), { status: 429 }), "quota"],
    ["an unsupported option", () => new Response(JSON.stringify({ error: { message: "aspect_ratio not supported for this model" } }), { status: 400 }), "unsupported"],
    ["an unknown model", () => new Response(JSON.stringify({ error: { message: "models/x is not found" } }), { status: 404 }), "model"],
    ["a rejected key", () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 401 }), "auth"],
    ["an outage", () => new Response("upstream down", { status: 503 }), "unavailable"],
    ["a response with no image", () => interaction([{ type: "text", text: "Here is a description instead." }]), "empty"],
    ["an empty image", () => interaction([{ type: "image", mime_type: "image/jpeg", data: "" }]), "empty"],
    ["a non-JSON body", () => new Response("<html>oops</html>", { status: 200 }), "invalid_image"],
  ])("maps %s to a clear error", async (_label, res, code) => {
    const err = await generateImage(config, { prompt: PROMPT, aspectRatio: "1:1" }, fetchReturning(res)).catch((e) => e);
    expect(err).toBeInstanceOf(ImageGenError);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain("test-gemini-key");
  });

  const hanging: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));

  it("stops at the timeout", async () => {
    const err = await generateImage({ ...config, timeoutMs: 50 }, { prompt: PROMPT, aspectRatio: "1:1" }, hanging).catch((e) => e);
    expect(err.code).toBe("timeout");
  });

  it("stops when the author cancels", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const err = await generateImage(config, { prompt: PROMPT, aspectRatio: "1:1", signal: ac.signal }, hanging).catch((e) => e);
    expect(err.code).toBe("cancelled");
  });
});

describe("generation workflow", () => {
  const start = (actor: Actor, f: typeof fetch, extra: Record<string, unknown> = {}) =>
    startGeneration(actor, { prompt: PROMPT, aspectRatio: "16:9", ...extra }, { config, fetchImpl: f, limits });

  it("refuses readers, and is unavailable when not configured", async () => {
    await expect(start(reader, fetchReturning(imageReply))).rejects.toMatchObject({ status: 403 });
    await expect(startGeneration(author, { prompt: PROMPT, aspectRatio: "16:9" }, { config: null })).rejects.toMatchObject({ status: 503 });
  });

  it("validates the prompt and aspect ratio", async () => {
    await expect(start(author, fetchReturning(imageReply), { prompt: "short" })).rejects.toMatchObject({ status: 400 });
    await expect(start(author, fetchReturning(imageReply), { aspectRatio: "7:3" })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps a verified result in temporary storage and records metadata, not the prompt", async () => {
    const g = await start(author, fetchReturning(imageReply));
    expect(g).toMatchObject({ width: 1, height: 1, model: "configured-image-model", previewUrl: `/api/admin/images/generations/${g.id}` });
    const [row] = await db.select().from(schema.imageGeneration).where(eq(schema.imageGeneration.id, g.id));
    expect(row).toMatchObject({ status: "succeeded", userId: "author", aspectRatio: "16:9", promptChars: PROMPT.length, contentType: "image/jpeg" });
    expect(row!.tempKey).toMatch(/^jithendar\/www\/tmp\/generated\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(JSON.stringify(row)).not.toContain("Kubernetes pods");
    expect(r2.objects.has(row!.tempKey!)).toBe(true);
    // Nothing is in the media library until the author accepts.
    expect(await db.select().from(schema.media)).toHaveLength(0);
  });

  it("never stores a response that is not a valid image", async () => {
    const f = fetchReturning(() => imageReply(Buffer.from("<html><script>alert(1)</script></html>")));
    await expect(start(author, f)).rejects.toMatchObject({ status: 502 });
    const [row] = await db.select().from(schema.imageGeneration);
    expect(row).toMatchObject({ status: "failed", errorCode: "invalid_image" });
    expect(r2.objects.size).toBe(0);
  });

  it("records refusals and passes the message on", async () => {
    const f = fetchReturning(() => new Response(JSON.stringify({ error: { message: "blocked by safety settings" } }), { status: 400 }));
    await expect(start(author, f)).rejects.toThrow("content policy");
    const [row] = await db.select().from(schema.imageGeneration);
    expect(row).toMatchObject({ status: "failed", errorCode: "refused" });
  });

  it("enforces the per-user hourly limit and one generation at a time", async () => {
    for (let i = 0; i < 3; i++) await start(author, fetchReturning(imageReply));
    await expect(start(author, fetchReturning(imageReply))).rejects.toMatchObject({ status: 429 });
    await expect(start(other, fetchReturning(imageReply))).resolves.toBeTruthy();

    await db.insert(schema.imageGeneration).values({ userId: admin.id, model: "m", aspectRatio: "1:1", imageSize: "1K", promptSha256: "x", promptChars: 20, status: "running" });
    await expect(startGeneration(admin, { prompt: PROMPT, aspectRatio: "1:1" }, { config, fetchImpl: fetchReturning(imageReply), limits })).rejects.toMatchObject({ status: 409 });
  });

  it("enforces the site-wide daily limit", async () => {
    await start(author, fetchReturning(imageReply));
    await expect(startGeneration(other, { prompt: PROMPT, aspectRatio: "16:9" }, { config, fetchImpl: fetchReturning(imageReply), limits: { ...limits, dailyTotal: 1 } })).rejects.toMatchObject({ status: 429 });
  });

  it("accepting copies the image into the media library and it can be saved as the post's cover", async () => {
    const g = await start(author, fetchReturning(imageReply));
    await expect(acceptGeneration(author, g.id, { alt: "" })).rejects.toMatchObject({ status: 400 });
    await expect(acceptGeneration(other, g.id, { alt: "Pods on a rack" })).rejects.toMatchObject({ status: 404 });

    const cover = await acceptGeneration(author, g.id, { alt: "Pods on a rack", context: "posts/blog/my-post", name: "my-post" });
    expect(cover).toMatchObject({ alt: "Pods on a rack", width: 1, height: 1 });
    expect(cover.src).toBe(`/media/${cover.id}/my-post.jpg`);
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, cover.id));
    expect(media!.storageKey).toMatch(new RegExp(`^jithendar/www/media/images/\\d{4}/\\d{2}/${cover.id}\\.jpg$`));
    expect(media).toMatchObject({ kind: "images", status: "ready", alt: "Pods on a rack", context: "posts/blog/my-post" });
    expect(r2.objects.has(media!.storageKey)).toBe(true);
    const [gen] = await db.select().from(schema.imageGeneration).where(eq(schema.imageGeneration.id, g.id));
    expect(gen).toMatchObject({ status: "accepted", mediaId: cover.id, tempKey: null });
    expect([...r2.objects.keys()].some((k) => k.includes("/tmp/"))).toBe(false);
    await expect(acceptGeneration(author, g.id, { alt: "again" })).rejects.toMatchObject({ status: 410 });

    // The editor puts the accepted image into featuredImage; saving the post stores the reference.
    await db.insert(schema.authorProfile).values({ userId: author.id, slug: "writer", displayName: "Writer" });
    const { id: _id, ...featuredImage } = cover;
    void _id;
    const post = await createPost(author, {
      collection: "blog",
      slug: "generated-cover-post",
      title: "A post with a generated cover image",
      description: "A description that is comfortably longer than fifty characters for the schema.",
      body: "Body.",
      category: "kubernetes",
      tags: [],
      contentType: "tutorial",
      status: "draft",
      featuredImage: { ...featuredImage, focalX: 30, focalY: 60 },
    });
    expect((await getPostRow(author, post.id)).featuredImage).toEqual({ ...featuredImage, focalX: 30, focalY: 60 });
    expect(post.status).toBe("draft");
  });

  it("discarding or expiring deletes the temporary image", async () => {
    const a = await start(author, fetchReturning(imageReply));
    await discardGeneration(author, a.id);
    expect(r2.objects.size).toBe(0);
    const [row] = await db.select().from(schema.imageGeneration).where(eq(schema.imageGeneration.id, a.id));
    expect(row!.status).toBe("discarded");

    const b = await start(author, fetchReturning(imageReply));
    expect(await expireGenerations(Date.now() + 2 * 60 * 60 * 1000)).toBe(1);
    expect(r2.objects.size).toBe(0);
    await expect(acceptGeneration(author, b.id, { alt: "late" })).rejects.toMatchObject({ status: 410 });
  });
});

describe("generate endpoint", () => {
  const req = (origin: string | null, body: unknown = { prompt: PROMPT, aspectRatio: "16:9" }) =>
    new Request("https://jithendar.com/api/admin/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "jithendar.com", ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });

  it("rejects cross-site requests before anything else", async () => {
    session.user = { id: author.id, name: "a", email: author.label, role: "author", emailVerified: true };
    expect((await generateRoute(req("https://evil.example"))).status).toBe(403);
    expect((await generateRoute(req(null))).status).toBe(403);
  });

  it("requires a signed-in editor", async () => {
    expect((await generateRoute(req("https://jithendar.com"))).status).toBe(401);
    session.user = { id: reader.id, name: "r", email: reader.label, role: "user", emailVerified: true };
    expect((await generateRoute(req("https://jithendar.com"))).status).toBe(403);
  });

  it("reports missing configuration as JSON without leaking anything", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    session.user = { id: author.id, name: "a", email: author.label, role: "author", emailVerified: true };
    const res = await generateRoute(req("https://jithendar.com"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Image generation is not configured." });
    vi.unstubAllEnvs();
  });
});
