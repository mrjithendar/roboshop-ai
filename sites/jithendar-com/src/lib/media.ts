import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { imageSize } from "image-size";
import { getDb, schema } from "@/db";
import { rowsOf } from "@/db/rows";
import { audit } from "./audit";
import { readLocalImage } from "./images";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { deleteObject, getObject, headObject, IMMUTABLE, mediaObjectKey, normaliseContext, presignPut, putObject, storageReady, type MediaKind } from "./storage";

export const MEDIA_PREFIX = "/media/";
const MEDIA_SRC = /^\/media\/([0-9a-f-]{36})\/[^/?#]+$/;
const MB = 1024 * 1024;

/** What may be uploaded, by kind. Types are checked against the file's bytes, never its name. SVG is refused: it can carry scripts. */
export const MEDIA_RULES: Record<MediaKind, { maxBytes: number; types: Record<string, string>; label: string }> = {
  images: { maxBytes: 10 * MB, label: "JPEG, PNG, WebP, AVIF or GIF", types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif" } },
  videos: { maxBytes: 200 * MB, label: "MP4 or WebM", types: { "video/mp4": "mp4", "video/webm": "webm" } },
  audio: { maxBytes: 50 * MB, label: "MP3, M4A, Ogg or WAV", types: { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav" } },
  documents: { maxBytes: 20 * MB, label: "PDF", types: { "application/pdf": "pdf" } },
};
export const MAX_IMAGE_BYTES = MEDIA_RULES.images.maxBytes;
const MAX_IMAGE_SIDE = 12_000;

export function kindOf(contentType: string): MediaKind | null {
  for (const [kind, rule] of Object.entries(MEDIA_RULES) as [MediaKind, (typeof MEDIA_RULES)[MediaKind]][]) {
    if (contentType in rule.types) return kind;
  }
  return null;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Identify a file from its first bytes (at least 16). Returns the MIME type or null if it is not an allowed format. */
export function sniffContentType(head: Uint8Array): string | null {
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    return "video/mp4";
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  if (ascii(head, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(head, 0, 3) === "ID3" || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(head, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/** The bytes must be the declared type. An M4A whose container brand is generic MP4 is still audio. */
function sameType(declared: string, sniffed: string | null): boolean {
  return declared === sniffed || (declared === "audio/mp4" && sniffed === "video/mp4");
}

export function sanitizeFilename(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "file";
  return `${base}.${ext === "jpeg" ? "jpg" : ext}`;
}

export const mediaSrc = (m: { id: string; filename: string }) => `${MEDIA_PREFIX}${m.id}/${m.filename}`;

export type UploadResult = { ok: true; id: string; src: string; width: number; height: number } | { ok: false; error: string };

type ImageCheck = { ok: true; contentType: string; ext: string; width: number; height: number } | { ok: false; error: string };

/** Validate image bytes by content: allowed format, decodable dimensions, sane size. */
export function inspectImage(bytes: Buffer): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: `Images must be ${MAX_IMAGE_BYTES / MB} MB or smaller.` };
  const contentType = sniffContentType(bytes.subarray(0, 32));
  const ext = contentType ? MEDIA_RULES.images.types[contentType] : undefined;
  if (!contentType || !ext) return { ok: false, error: `Use a ${MEDIA_RULES.images.label} image (SVG is not allowed).` };
  let info: { width?: number; height?: number };
  try {
    info = imageSize(bytes);
  } catch {
    return { ok: false, error: "That file is not a readable image." };
  }
  if (!info.width || !info.height) return { ok: false, error: "That file is not a readable image." };
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) return { ok: false, error: `Images must be at most ${MAX_IMAGE_SIDE} pixels on each side.` };
  return { ok: true, contentType, ext, width: info.width, height: info.height };
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const md5Base64 = (b: Buffer) => createHash("md5").update(b).digest("base64");

/**
 * Store an image uploaded through the server (editor and media library): validate by content, write it
 * to R2 under jithendar/www/media/images/{yyyy}/{mm}/{id}.{ext} with an MD5 integrity check, record it.
 */
export async function storeUpload(file: { name: string; bytes: Buffer }, alt: string, userId: string, context = "library"): Promise<UploadResult> {
  if (!(await storageReady())) return { ok: false, error: "Media storage (Cloudflare R2) is not configured. An admin must set it up under Admin → Storage first." };
  const check = inspectImage(file.bytes);
  if (!check.ok) return check;
  if (!alt.trim()) return { ok: false, error: "Alt text is required." };
  const id = crypto.randomUUID();
  const filename = sanitizeFilename(file.name, check.ext);
  const storageKey = mediaObjectKey("images", id, check.ext);
  await putObject(storageKey, file.bytes, { contentType: check.contentType, cacheControl: IMMUTABLE, contentMd5: md5Base64(file.bytes) });
  const db = await getDb();
  await db.insert(schema.media).values({
    id,
    filename,
    contentType: check.contentType,
    storageKey,
    storageBackend: "r2",
    kind: "images",
    checksumSha256: sha256(file.bytes),
    context: normaliseContext(context),
    sizeBytes: file.bytes.length,
    width: check.width,
    height: check.height,
    alt: alt.trim().slice(0, 300),
    uploadedBy: userId,
  });
  return { ok: true, id, src: mediaSrc({ id, filename }), width: check.width, height: check.height };
}

/** Record an image whose bytes are already in R2 at `storageKey` (an accepted AI generation). */
export async function recordImage(row: { id: string; filename: string; storageKey: string; contentType: string; sizeBytes: number; width: number; height: number; alt: string; checksumSha256: string; context: string; userId: string }) {
  const db = await getDb();
  await db.insert(schema.media).values({
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    storageKey: row.storageKey,
    storageBackend: "r2",
    kind: "images",
    checksumSha256: row.checksumSha256,
    context: normaliseContext(row.context),
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    alt: row.alt,
    uploadedBy: row.userId,
  });
}

// --- Direct (presigned) uploads: large files go from the browser straight to R2 ------------------

const PENDING_TTL_MS = 60 * 60 * 1000;
const MAX_PENDING_PER_USER = 5;

export type UploadIntent = { id: string; uploadUrl: string; headers: Record<string, string>; expiresInSeconds: number };

/**
 * Step 1: validate the declared file and return a 10-minute presigned PUT for exactly that type and size.
 * The row stays "pending" (invisible everywhere) until step 2 verifies what actually arrived.
 */
export async function createUploadIntent(
  actor: Actor,
  input: { filename: string; contentType: string; size: number; sha256: string; alt?: string; visibility?: string; context?: string },
): Promise<UploadIntent> {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  if (!(await storageReady())) throw new PostError("Media storage (Cloudflare R2) is not configured.", 409);
  const kind = kindOf(input.contentType);
  if (!kind) throw new PostError("That file type is not allowed. Use an image, MP4/WebM video, MP3/M4A/Ogg/WAV audio or a PDF.", 415);
  const rule = MEDIA_RULES[kind];
  if (!Number.isInteger(input.size) || input.size <= 0) throw new PostError("The file is empty.", 400);
  if (input.size > rule.maxBytes) throw new PostError(`${kind[0]!.toUpperCase()}${kind.slice(1)} must be ${rule.maxBytes / MB} MB or smaller.`, 413);
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new PostError("Missing file checksum.", 400);
  const alt = (input.alt ?? "").trim().slice(0, 300);
  if (kind === "images" && !alt) throw new PostError("Alt text is required for images.", 400);
  const visibility = input.visibility === "private" ? "private" : "public";

  await purgeStaleUploads();
  const db = await getDb();
  const [{ n } = { n: 0 }] = rowsOf<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from media where status = 'pending' and uploaded_by = ${actor.id}`),
  );
  if (Number(n) >= MAX_PENDING_PER_USER) throw new PostError("Too many uploads in progress. Wait for them to finish.", 429);

  const ext = rule.types[input.contentType]!;
  const id = crypto.randomUUID();
  const storageKey = mediaObjectKey(kind, id, ext);
  await db.insert(schema.media).values({
    id,
    filename: sanitizeFilename(input.filename, ext),
    contentType: input.contentType,
    storageKey,
    storageBackend: "r2",
    kind,
    visibility,
    status: "pending",
    checksumSha256: input.sha256,
    context: normaliseContext(input.context),
    sizeBytes: input.size,
    alt,
    uploadedBy: actor.id,
  });
  const expiresInSeconds = 600;
  const uploadUrl = await presignPut(storageKey, input.contentType, input.size, expiresInSeconds);
  // The browser sends these with the PUT (the bucket's CORS policy must allow both headers).
  return { id, uploadUrl, headers: { "Content-Type": input.contentType, "Cache-Control": IMMUTABLE }, expiresInSeconds };
}

/** Step 2: check what arrived (size, SHA-256, real type, image dimensions); anything wrong is deleted. */
export async function completeUpload(actor: Actor, id: string): Promise<UploadResult> {
  const db = await getDb();
  const [row] = await db.select().from(schema.media).where(and(eq(schema.media.id, id), eq(schema.media.status, "pending")));
  if (!row || (row.uploadedBy !== actor.id && actor.role !== "admin")) throw new PostError("Upload not found.", 404);
  const reject = async (error: string): Promise<UploadResult> => {
    await deleteObject(row.storageKey).catch(() => undefined);
    await db.delete(schema.media).where(eq(schema.media.id, id));
    return { ok: false, error };
  };
  const head = await headObject(row.storageKey);
  if (!head) return reject("The file did not arrive. Check your connection and try again.");
  if (head.size !== row.sizeBytes) return reject("The uploaded file is not the size that was declared.");

  const res = await getObject(row.storageKey);
  if (!res?.Body) return reject("The file could not be read back.");
  const hash = createHash("sha256");
  const keep: Buffer[] = [];
  let first: Buffer | undefined;
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    const b = Buffer.from(chunk);
    hash.update(b);
    first ??= b;
    if (row.kind === "images") keep.push(b);
  }
  if (hash.digest("hex") !== row.checksumSha256) return reject("The file was corrupted in transit (checksum mismatch). Try again.");
  if (!first || !sameType(row.contentType, sniffContentType(first.subarray(0, 32)))) return reject(`The file is not a valid ${row.contentType} file.`);

  let width: number | null = null;
  let height: number | null = null;
  if (row.kind === "images") {
    const check = inspectImage(Buffer.concat(keep));
    if (!check.ok) return reject(check.error);
    width = check.width;
    height = check.height;
  }
  await db.update(schema.media).set({ status: "ready", width, height }).where(eq(schema.media.id, id));
  await audit(actor, "media.upload", id, { kind: row.kind, bytes: row.sizeBytes, visibility: row.visibility });
  return { ok: true, id, src: mediaSrc(row), width: width ?? 0, height: height ?? 0 };
}

/** Pending uploads older than an hour were abandoned: remove their objects and rows. */
export async function purgeStaleUploads(now = Date.now()): Promise<number> {
  const db = await getDb();
  const stale = await db
    .select({ id: schema.media.id, key: schema.media.storageKey })
    .from(schema.media)
    .where(and(eq(schema.media.status, "pending"), lt(schema.media.createdAt, new Date(now - PENDING_TTL_MS))))
    .limit(50);
  for (const s of stale) {
    await deleteObject(s.key).catch(() => undefined);
    await db.delete(schema.media).where(eq(schema.media.id, s.id));
  }
  return stale.length;
}

// --- Reading ------------------------------------------------------------------------------------

export type ResolvedImage = { src: string; width: number; height: number; svg: boolean };

/** Resolve a content image src (/images/... file or public /media/... upload) to its intrinsic size. */
export async function resolveImage(src: string): Promise<ResolvedImage | undefined> {
  const m = MEDIA_SRC.exec(src);
  if (m) {
    const db = await getDb();
    const [row] = await db
      .select({ width: schema.media.width, height: schema.media.height, kind: schema.media.kind, status: schema.media.status, visibility: schema.media.visibility })
      .from(schema.media)
      .where(eq(schema.media.id, m[1]!));
    if (!row || row.kind !== "images" || row.status !== "ready" || row.visibility !== "public" || !row.width || !row.height) return undefined;
    return { src, width: row.width, height: row.height, svg: false };
  }
  const local = readLocalImage(src);
  return local ? { src: local.src, width: local.width, height: local.height, svg: local.svg } : undefined;
}

export type ResolvedMedia = { src: string; kind: MediaKind; contentType: string; alt: string };

/** Resolve a /media/... src of any kind (video, audio, documents) for the content shortcodes. */
export async function resolveMedia(src: string): Promise<ResolvedMedia | undefined> {
  const m = MEDIA_SRC.exec(src);
  if (!m) return undefined;
  const db = await getDb();
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, m[1]!));
  if (!row || row.status !== "ready" || row.visibility !== "public") return undefined;
  return { src, kind: row.kind as MediaKind, contentType: row.contentType, alt: row.alt };
}

/** Delete an upload (object + row). Refused while a post or page still references it. */
export async function deleteMedia(actor: Actor, id: string) {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  const db = await getDb();
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
  if (!row) throw new PostError("File not found.", 404);
  const needle = `${MEDIA_PREFIX}${row.id}/`;
  const [{ n } = { n: 0 }] = rowsOf<{ n: number }>(
    await db.execute(sql`
    select (select count(*) from post where body like ${"%" + needle + "%"} or featured_image->>'src' like ${needle + "%"})
         + (select count(*) from page where body like ${"%" + needle + "%"}) as n`),
  );
  if (Number(n) > 0) throw new PostError(`This file is used by ${n} post(s) or page(s). Remove it there first.`, 409);
  // Objects still on the legacy S3 bucket are left in place (that bucket is read-only to the site).
  if (row.storageBackend === "r2") await deleteObject(row.storageKey);
  await db.delete(schema.media).where(eq(schema.media.id, id));
  await audit(actor, "media.delete", id, { key: row.storageKey, backend: row.storageBackend });
}

/** How many posts/pages reference each media item (shown before deleting shared media). */
export async function mediaUsage(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const db = await getDb();
  const posts = await db.select({ body: schema.post.body, cover: schema.post.featuredImage, social: schema.post.socialImage }).from(schema.post);
  const pages = await db.select({ body: schema.page.body }).from(schema.page);
  const texts = [...posts.map((p) => `${p.body} ${p.cover?.src ?? ""} ${p.social?.src ?? ""}`), ...pages.map((p) => p.body)];
  for (const id of ids) out.set(id, texts.filter((t) => t.includes(`${MEDIA_PREFIX}${id}/`)).length);
  return out;
}

/** Edit an item's alt text/description (used as the default when it is inserted again). */
export async function updateMediaAlt(actor: Actor, id: string, alt: string) {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  const text = alt.trim().slice(0, 300);
  const db = await getDb();
  const [row] = await db.update(schema.media).set({ alt: text }).where(eq(schema.media.id, id)).returning({ id: schema.media.id, kind: schema.media.kind });
  if (!row) throw new PostError("File not found.", 404);
  if (row.kind === "images" && !text) throw new PostError("Images need alt text.", 400);
  await audit(actor, "media.alt", id, {});
}
