import { eq } from "drizzle-orm";
import { imageSize } from "image-size";
import { getDb, schema } from "@/db";
import { MAX_IMAGE_BYTES, readLocalImage } from "./images";
import { mediaObjectKey, normaliseContext, putObject, storageReady } from "./storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif" };
export const MEDIA_PREFIX = "/media/";
const MEDIA_SRC = /^\/media\/([0-9a-f-]{36})\/[^/?#]+$/;

export type UploadResult = { ok: true; id: string; src: string; width: number; height: number } | { ok: false; error: string };

export function sanitizeFilename(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "image";
  return `${base}.${ext === "jpeg" ? "jpg" : ext}`;
}

/**
 * Validate by content (not by name or declared type), store the bytes in S3 under an organised key,
 * then record the metadata. SVG is refused: it can carry scripts. Refused entirely until S3 is configured.
 */
export async function storeUpload(file: { name: string; bytes: Buffer }, alt: string, userId: string, context = "library"): Promise<UploadResult> {
  if (!(await storageReady())) return { ok: false, error: "Media storage (S3) is not configured. An admin must set it up under Admin → Storage first." };
  if (file.bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (file.bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: `Images must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.` };
  let info: { width?: number; height?: number; type?: string };
  try {
    info = imageSize(file.bytes);
  } catch {
    return { ok: false, error: "That file is not a supported image." };
  }
  const ext = info.type === "jpeg" ? "jpg" : (info.type ?? "");
  const contentType = TYPES[ext];
  if (!contentType || !info.width || !info.height) return { ok: false, error: "Use a JPEG, PNG, WebP, AVIF or GIF image (SVG is not allowed)." };
  if (!alt.trim()) return { ok: false, error: "Alt text is required." };
  const filename = sanitizeFilename(file.name, ext);
  const id = crypto.randomUUID();
  const folder = normaliseContext(context);
  const storageKey = await mediaObjectKey(folder, filename, id);
  await putObject(storageKey, file.bytes, contentType);
  const db = await getDb();
  await db.insert(schema.media).values({
    id,
    filename,
    contentType,
    storageKey,
    context: folder,
    sizeBytes: file.bytes.length,
    width: info.width,
    height: info.height,
    alt: alt.trim(),
    uploadedBy: userId,
  });
  return { ok: true, id, src: `${MEDIA_PREFIX}${id}/${filename}`, width: info.width, height: info.height };
}

export type ResolvedImage = { src: string; width: number; height: number; svg: boolean };

/** Resolve a content image src (/images/... file or /media/... upload) to its intrinsic size. */
export async function resolveImage(src: string): Promise<ResolvedImage | undefined> {
  const m = MEDIA_SRC.exec(src);
  if (m) {
    const db = await getDb();
    const [row] = await db.select({ width: schema.media.width, height: schema.media.height }).from(schema.media).where(eq(schema.media.id, m[1]!));
    return row ? { src, width: row.width, height: row.height, svg: false } : undefined;
  }
  const local = readLocalImage(src);
  return local ? { src: local.src, width: local.width, height: local.height, svg: local.svg } : undefined;
}

/** Delete an upload (S3 object + row). Refused while a post or page still references it. */
export async function deleteMedia(actor: { id: string; role: string; label: string }, id: string) {
  const { PostError } = await import("./posts");
  const { audit } = await import("./audit");
  const { deleteObject } = await import("./storage");
  const { sql } = await import("drizzle-orm");
  const { rowsOf } = await import("@/db/rows");
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  const db = await getDb();
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
  if (!row) throw new PostError("Image not found.", 404);
  const needle = `${MEDIA_PREFIX}${row.id}/`;
  const [{ n } = { n: 0 }] = rowsOf<{ n: number }>(
    await db.execute(sql`
    select (select count(*) from post where body like ${"%" + needle + "%"} or featured_image->>'src' like ${needle + "%"})
         + (select count(*) from page where body like ${"%" + needle + "%"}) as n`),
  );
  if (Number(n) > 0) throw new PostError(`This image is used by ${n} post(s) or page(s). Remove it there first.`, 409);
  await deleteObject(row.storageKey);
  await db.delete(schema.media).where(eq(schema.media.id, id));
  await audit(actor, "media.delete", id, { key: row.storageKey });
}
