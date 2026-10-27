"use server";

import fs from "node:fs";
import path from "node:path";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { staffActor } from "@/lib/admin";
import { publicRoot, readLocalImage } from "@/lib/images";
import { storeUpload } from "@/lib/media";
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

export async function listMedia(limit = 60): Promise<MediaItem[]> {
  await staffActor();
  const db = await getDb();
  const rows = await db
    .select({ id: schema.media.id, filename: schema.media.filename, alt: schema.media.alt, width: schema.media.width, height: schema.media.height, context: schema.media.context })
    .from(schema.media)
    .orderBy(desc(schema.media.createdAt))
    .limit(limit);
  const uploads = rows.map((r) => ({ id: r.id, src: `/media/${r.id}/${r.filename}`, alt: r.alt, width: r.width, height: r.height, context: r.context }));
  return [...uploads, ...bundledImages()];
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
