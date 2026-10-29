import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import type { Actor } from "@/lib/posts";
import { fakeR2, JPEG_1x1, PNG_1x1 } from "./fake-r2";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
const r2 = fakeR2();
vi.mock("@/lib/storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/storage")>()), ...r2 }));
const session = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));
vi.mock("@/lib/session", () => ({ getSessionUser: async () => session.user }));

const { completeUpload, createUploadIntent, deleteMedia, resolveImage, sniffContentType, storeUpload } = await import("@/lib/media");
const { mediaObjectKey, tempObjectKey } = await import("@/lib/storage");
const { GET: mediaRoute } = await import("@/app/media/[id]/[name]/route");

const admin: Actor = { id: "admin", role: "admin", label: "admin@example.com" };
const author: Actor = { id: "author", role: "author", label: "a@example.com" };
const other: Actor = { id: "other", role: "author", label: "o@example.com" };
const reader: Actor = { id: "reader", role: "user", label: "r@example.com" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let db: Db;
beforeEach(async () => {
  r2.objects.clear();
  session.user = null;
  db = await freshDb();
  for (const a of [admin, author, other, reader]) await db.insert(schema.user).values({ id: a.id, name: a.id, email: a.label, role: a.role });
});
afterEach(() => setDbForTests(undefined));

describe("R2 object keys", () => {
  it("follows jithendar/www/media/{type}/{yyyy}/{mm}/{unique-id}.{extension}", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const at = new Date("2026-03-09T23:30:00Z");
    expect(mediaObjectKey("images", id, "webp", at)).toBe(`jithendar/www/media/images/2026/03/${id}.webp`);
    expect(mediaObjectKey("videos", id, "mp4", at)).toBe(`jithendar/www/media/videos/2026/03/${id}.mp4`);
    expect(mediaObjectKey("audio", id, "mp3", at)).toBe(`jithendar/www/media/audio/2026/03/${id}.mp3`);
    expect(mediaObjectKey("documents", id, "pdf", at)).toBe(`jithendar/www/media/documents/2026/03/${id}.pdf`);
    expect(tempObjectKey(id, "jpg", at)).toBe(`jithendar/www/tmp/generated/2026/03/${id}.jpg`);
  });

  it("never builds a key from user input", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(() => mediaObjectKey("images", "../../etc/passwd", "jpg")).toThrow();
    expect(() => mediaObjectKey("images", id, "php?x=1")).toThrow();
    expect(() => mediaObjectKey("scripts" as never, id, "js")).toThrow();
  });
});

describe("content validation", () => {
  it("identifies files by their bytes, not their names", () => {
    const head = (s: string, pad = 16) => Buffer.concat([Buffer.from(s, "latin1"), Buffer.alloc(pad)]);
    expect(sniffContentType(PNG_1x1)).toBe("image/png");
    expect(sniffContentType(JPEG_1x1)).toBe("image/jpeg");
    expect(sniffContentType(head("GIF89a"))).toBe("image/gif");
    expect(sniffContentType(head("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffContentType(head("\0\0\0\x1cftypavif"))).toBe("image/avif");
    expect(sniffContentType(head("\0\0\0\x18ftypisom"))).toBe("video/mp4");
    expect(sniffContentType(head("\0\0\0\x18ftypM4A "))).toBe("audio/mp4");
    expect(sniffContentType(head("\x1a\x45\xdf\xa3"))).toBe("video/webm");
    expect(sniffContentType(head("ID3\x04"))).toBe("audio/mpeg");
    expect(sniffContentType(head("OggS"))).toBe("audio/ogg");
    expect(sniffContentType(head("RIFF\0\0\0\0WAVEfmt "))).toBe("audio/wav");
    expect(sniffContentType(head("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffContentType(head('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffContentType(head("<!doctype html><script>"))).toBeNull();
  });

  it("stores a server-side image upload under the R2 structure with an integrity check", async () => {
    const r = await storeUpload({ name: "My Diagram (final).PNG", bytes: PNG_1x1 }, "Architecture diagram", author.id, "posts/blog/my-post");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, r.id));
    expect(row!.storageKey).toMatch(new RegExp(`^jithendar/www/media/images/\\d{4}/\\d{2}/${r.id}\\.png$`));
    expect(r.id).toMatch(UUID);
    expect(row).toMatchObject({ filename: "my-diagram-final.png", contentType: "image/png", kind: "images", storageBackend: "r2", status: "ready", width: 1, height: 1, checksumSha256: sha(PNG_1x1) });
    expect(r2.objects.get(row!.storageKey)?.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(r.src).toBe(`/media/${r.id}/my-diagram-final.png`);
  });

  it("refuses SVG, HTML disguised as an image, empty and oversized files, and missing alt text", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(await storeUpload({ name: "x.svg", bytes: svg }, "alt", author.id)).toMatchObject({ ok: false });
    expect(await storeUpload({ name: "x.png", bytes: Buffer.from("<html><script>alert(1)</script></html>") }, "alt", author.id)).toMatchObject({ ok: false });
    expect(await storeUpload({ name: "x.png", bytes: Buffer.alloc(0) }, "alt", author.id)).toMatchObject({ ok: false, error: "The file is empty." });
    expect(await storeUpload({ name: "x.png", bytes: Buffer.concat([PNG_1x1, Buffer.alloc(11 * 1024 * 1024)]) }, "alt", author.id)).toMatchObject({ ok: false });
    expect(await storeUpload({ name: "x.png", bytes: PNG_1x1 }, "  ", author.id)).toMatchObject({ ok: false, error: "Alt text is required." });
    expect(r2.objects.size).toBe(0);
  });
});

describe("presigned (direct) uploads", () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 32)]);
  const intent = (overrides: Record<string, unknown> = {}) => ({ filename: "Report.pdf", contentType: "application/pdf", size: pdf.length, sha256: sha(pdf), alt: "Annual report", ...overrides });

  it("refuses readers and signed-out users", async () => {
    await expect(createUploadIntent(reader, intent())).rejects.toMatchObject({ status: 403 });
  });

  it("refuses disallowed types, oversized files and missing checksums before signing anything", async () => {
    await expect(createUploadIntent(author, intent({ contentType: "text/html" }))).rejects.toMatchObject({ status: 415 });
    await expect(createUploadIntent(author, intent({ contentType: "image/svg+xml" }))).rejects.toMatchObject({ status: 415 });
    await expect(createUploadIntent(author, intent({ size: 21 * 1024 * 1024 }))).rejects.toMatchObject({ status: 413 });
    await expect(createUploadIntent(author, intent({ sha256: "nope" }))).rejects.toMatchObject({ status: 400 });
    await expect(createUploadIntent(author, intent({ contentType: "image/png", alt: "" }))).rejects.toThrow("Alt text");
  });

  it("verifies what arrived (size, SHA-256, real type) before the file becomes visible", async () => {
    const i = await createUploadIntent(author, intent());
    expect(i.uploadUrl).toContain(`jithendar/www/media/documents/`);
    expect(i.headers["Content-Type"]).toBe("application/pdf");
    // Pending rows are invisible to the public route.
    expect((await mediaRoute(new Request("https://jithendar.com/x"), { params: Promise.resolve({ id: i.id, name: "report.pdf" }) })).status).toBe(404);

    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, i.id));
    await r2.putObject(row!.storageKey, pdf, { contentType: "application/pdf" });
    await expect(completeUpload(other, i.id)).rejects.toMatchObject({ status: 404 });
    expect(await completeUpload(author, i.id)).toMatchObject({ ok: true, src: `/media/${i.id}/report.pdf` });
    const [done] = await db.select().from(schema.media).where(eq(schema.media.id, i.id));
    expect(done!.status).toBe("ready");
  });

  it("deletes uploads whose bytes do not match the declaration", async () => {
    const i = await createUploadIntent(author, intent());
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, i.id));
    const tampered = Buffer.from(pdf);
    tampered[50] = 65;
    await r2.putObject(row!.storageKey, tampered, { contentType: "application/pdf" });
    expect(await completeUpload(author, i.id)).toMatchObject({ ok: false, error: expect.stringContaining("checksum") });
    expect(r2.objects.has(row!.storageKey)).toBe(false);
    expect(await db.select().from(schema.media).where(eq(schema.media.id, i.id))).toHaveLength(0);

    // A "PDF" that is really HTML is rejected by content sniffing.
    const html = Buffer.from("<html><body>not a pdf</body></html>");
    const j = await createUploadIntent(author, intent({ size: html.length, sha256: sha(html) }));
    const [row2] = await db.select().from(schema.media).where(eq(schema.media.id, j.id));
    await r2.putObject(row2!.storageKey, html, { contentType: "application/pdf" });
    expect(await completeUpload(author, j.id)).toMatchObject({ ok: false, error: expect.stringContaining("not a valid") });
  });
});

describe("delivery", () => {
  it("serves public images from R2 with immutable caching, and hides private files from the public", async () => {
    const r = await storeUpload({ name: "pic.png", bytes: PNG_1x1 }, "A picture", author.id);
    if (!r.ok) throw new Error(r.error);
    const res = await mediaRoute(new Request("https://jithendar.com/x"), { params: Promise.resolve({ id: r.id, name: "pic.png" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_1x1)).toBe(true);
    expect(await resolveImage(r.src)).toEqual({ src: r.src, width: 1, height: 1, svg: false });

    await db.update(schema.media).set({ visibility: "private" }).where(eq(schema.media.id, r.id));
    const hidden = await mediaRoute(new Request("https://jithendar.com/x"), { params: Promise.resolve({ id: r.id, name: "pic.png" }) });
    expect(hidden.status).toBe(404);
    expect(await resolveImage(r.src)).toBeUndefined();
    session.user = { id: author.id, role: "author" };
    const staff = await mediaRoute(new Request("https://jithendar.com/x"), { params: Promise.resolve({ id: r.id, name: "pic.png" }) });
    expect(staff.status).toBe(302);
    expect(staff.headers.get("location")).toContain("X-Amz-Signature");
    expect(staff.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses to delete media that a post still uses", async () => {
    const r = await storeUpload({ name: "pic.png", bytes: PNG_1x1 }, "A picture", author.id);
    if (!r.ok) throw new Error(r.error);
    await db.insert(schema.authorProfile).values({ userId: author.id, slug: "a", displayName: "A" });
    await db.insert(schema.post).values({ collection: "blog", slug: "p", title: "t", description: "d", body: `![x](${r.src})`, category: "kubernetes", contentType: "tutorial", status: "draft", authorId: author.id });
    await expect(deleteMedia(author, r.id)).rejects.toMatchObject({ status: 409 });
    await expect(deleteMedia(reader, r.id)).rejects.toMatchObject({ status: 403 });
  });
});
