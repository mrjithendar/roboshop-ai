"use server";

import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FeaturedImage } from "@/db/schema";
import { staffActor } from "@/lib/admin";
import { acceptGeneration, discardGeneration } from "@/lib/image-generation";
import { publicRoot, readLocalImage } from "@/lib/images";
import { completeUpload, createUploadIntent, mediaSrc, storeUpload, type UploadIntent, type UploadResult } from "@/lib/media";
import { createPreview, type PreviewKind } from "@/lib/preview";
import { PostError } from "@/lib/posts";
import { storageReady } from "@/lib/storage";

export type MediaItem = { id: string; src: string; alt: string; width: number; height: number; context: string };

/** Images shipped with the site under public/images (usable as covers even before S3 is configured). */
function bundledImages(): MediaItem[] {
  const root = path.join(/*turbopackIgnore: true*/ publicRoot(), "images");
  if (!fs.existsSync(root)) return [];
  const found: MediaItem[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(/*turbopackIgnore: true*/ dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jpe?g|png|webp|avif)$/i.test(entry.name)) {
        const src = "/" + path.relative(publicRoot(), full).split(path.sep).join("/");
        const img = readLocalImage(src);
        if (img) found.push({ id: `bundled:${src}`, src, alt: "", width: img.width, height: img.height, context: "bundled" });
      }
    }
  };
  walk(root);
  return found;
}

/** Image library for pickers: newest first, searchable by alt text or file name, paged. */
export async function listMedia(opts: { q?: string; page?: number } = {}): Promise<{ items: MediaItem[]; more: boolean }> {
  await staffActor();
  const db = await getDb();
  const size = 24;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const q = opts.q?.trim().slice(0, 100);
  const like = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : undefined;
  const rows = await db
    .select({ id: schema.media.id, filename: schema.media.filename, alt: schema.media.alt, width: schema.media.width, height: schema.media.height, context: schema.media.context })
    .from(schema.media)
    .where(and(eq(schema.media.kind, "images"), eq(schema.media.status, "ready"), eq(schema.media.visibility, "public"), like ? or(ilike(schema.media.alt, like), ilike(schema.media.filename, like)) : undefined))
    .orderBy(desc(schema.media.createdAt))
    .limit(size + 1)
    .offset((page - 1) * size);
  const uploads = rows.slice(0, size).map((r) => ({ id: r.id, src: mediaSrc(r), alt: r.alt, width: r.width ?? 0, height: r.height ?? 0, context: r.context }));
  // Bundled site images are listed on the first page only (they are few and never change).
  const bundled = page === 1 ? bundledImages().filter((b) => !q || b.src.toLowerCase().includes(q.toLowerCase())) : [];
  return { items: [...uploads, ...bundled], more: rows.length > size };
}

export async function mediaUploadsEnabled(): Promise<boolean> {
  await staffActor();
  return storageReady();
}

export async function uploadMedia(form: FormData) {
  const actor = await staffActor();
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "Choose an image to upload." };
  return storeUpload({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, String(form.get("alt") ?? ""), actor.id, String(form.get("context") ?? "library"));
}

/** Store the editor's current content for /preview/<token> (opened in a new tab). */
export async function createPreviewAction(kind: PreviewKind, payload: unknown): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const actor = await staffActor();
  try {
    return { ok: true, token: await createPreview(actor, kind, payload) };
  } catch (error) {
    return { ok: false, error: error instanceof PostError ? error.message : "Preview is unavailable right now." };
  }
}

const failure = (error: unknown) => ({ ok: false as const, error: error instanceof PostError ? error.message : "Something went wrong. Try again." });

/** Direct upload, step 1: a short-lived presigned PUT for exactly the declared file. */
export async function requestUpload(input: { filename: string; contentType: string; size: number; sha256: string; alt?: string; visibility?: string; context?: string }): Promise<({ ok: true } & UploadIntent) | { ok: false; error: string }> {
  const actor = await staffActor();
  try {
    return { ok: true, ...(await createUploadIntent(actor, input)) };
  } catch (error) {
    return failure(error);
  }
}

/** Direct upload, step 2: verify what arrived in R2 (size, checksum, real type). */
export async function finishUpload(id: string): Promise<UploadResult> {
  const actor = await staffActor();
  try {
    return await completeUpload(actor, id);
  } catch (error) {
    return failure(error);
  }
}

/** The author chose "Use as cover" for a generated image. */
export async function acceptGeneratedImage(id: string, alt: string, context: string): Promise<{ ok: true; image: FeaturedImage } | { ok: false; error: string }> {
  const actor = await staffActor();
  try {
    const { id: _mediaId, ...image } = await acceptGeneration(actor, id, { alt, context, name: context.split("/").pop() });
    void _mediaId;
    return { ok: true, image };
  } catch (error) {
    return failure(error);
  }
}

export async function discardGeneratedImage(id: string): Promise<void> {
  const actor = await staffActor();
  await discardGeneration(actor, id).catch(() => undefined);
}
