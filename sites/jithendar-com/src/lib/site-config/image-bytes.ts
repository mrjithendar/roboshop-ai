import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { publicRoot } from "../images";
import { getObjectBytes } from "../storage";

const MAX = 8 * 1024 * 1024;

/**
 * Bytes of one of our own images (shipped under /images or uploaded to /media), for server-side rendering
 * such as the social card. Never fetches a URL. Returns null for anything else.
 */
export async function ownImageBytes(src: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const media = /^\/media\/([0-9a-f-]{36})\//.exec(src);
  if (media) {
    const db = await getDb();
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, media[1]!));
    if (!row || row.kind !== "images" || row.status !== "ready" || row.visibility !== "public" || row.storageBackend !== "r2") return null;
    const bytes = await getObjectBytes(row.storageKey, MAX).catch(() => null);
    return bytes ? { bytes, contentType: row.contentType } : null;
  }
  const local = /^\/images\/([A-Za-z0-9/_.-]+)$/.exec(src);
  if (local && !local[1]!.includes("..")) {
    const file = path.join(publicRoot(), "images", local[1]!);
    if (!fs.existsSync(file) || fs.statSync(file).size > MAX) return null;
    const ext = path.extname(file).toLowerCase();
    const contentType = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "";
    return contentType ? { bytes: fs.readFileSync(file), contentType } : null;
  }
  return null;
}
