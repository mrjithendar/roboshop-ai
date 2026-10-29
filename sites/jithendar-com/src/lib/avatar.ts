import "server-only";
import sharp from "sharp";
import { inspectImage } from "./media";
import { MEDIA_ROOT } from "./storage";

const MB = 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 512;
/** Better Auth ids (and UUIDs) only; used in object keys and URLs, so nothing else is accepted. */
const USER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const AVATAR_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export type AvatarLimits = { maxBytes: number; maxSide: number; minSide: number };

function intEnv(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** AVATAR_MAX_BYTES (default 2 MB, at most 10 MB), AVATAR_MAX_DIMENSION (default 4096 px), AVATAR_MIN_DIMENSION (default 64 px). */
export function avatarLimits(env: Record<string, string | undefined> = process.env): AvatarLimits {
  return {
    maxBytes: intEnv(env.AVATAR_MAX_BYTES, 2 * MB, 64 * 1024, 10 * MB),
    maxSide: intEnv(env.AVATAR_MAX_DIMENSION, 4096, 256, 12_000),
    minSide: intEnv(env.AVATAR_MIN_DIMENSION, 64, 16, 1024),
  };
}

/** R2 key: jithendar/www/media/images/avatars/{user-id}/{unique-id}.webp */
export function avatarObjectKey(userId: string, fileId: string): string {
  if (!USER_ID.test(userId)) throw new Error("Invalid user id for an avatar key.");
  return `${MEDIA_ROOT}/images/avatars/${userId}/${fileId}.webp`;
}

/** Public URL under our own domain (served by app/media/avatars/[userId]/[file]). */
export const avatarSrc = (userId: string, fileId: string) => `/media/avatars/${userId}/${fileId}.webp`;

/** Parse one of our avatar URLs back into its parts; null for anything else (e.g. a provider avatar URL). */
export function parseAvatarSrc(src: string | null | undefined): { userId: string; file: string } | null {
  const m = /^\/media\/avatars\/([^/]+)\/([^/]+)$/.exec(src ?? "");
  return m && USER_ID.test(m[1]!) && AVATAR_FILE.test(m[2]!) ? { userId: m[1]!, file: m[2]! } : null;
}

export const isAvatarRequest = (userId: string, file: string) => USER_ID.test(userId) && AVATAR_FILE.test(file);

export type ProcessedAvatar = { ok: true; bytes: Buffer; contentType: "image/webp" } | { ok: false; error: string };

/**
 * Validate and normalise an uploaded avatar:
 * - size limit first, then the format from the file's bytes (never its name or declared type) and its
 *   dimensions from the header, before any pixel is decoded (no decompression bombs);
 * - decode with a pixel limit, honour EXIF orientation, centre-crop to a 512 px square, re-encode as WebP.
 *   Re-encoding drops every metadata block (EXIF, GPS, XMP, ICC) and any trailing bytes.
 * Animated GIFs keep their first frame only.
 */
export async function processAvatar(input: Buffer, limits: AvatarLimits = avatarLimits()): Promise<ProcessedAvatar> {
  if (input.length === 0) return { ok: false, error: "The file is empty." };
  if (input.length > limits.maxBytes) return { ok: false, error: `Avatars must be ${(limits.maxBytes / MB).toFixed(limits.maxBytes % MB ? 1 : 0)} MB or smaller.` };
  const check = inspectImage(input);
  if (!check.ok) return check;
  if (check.width > limits.maxSide || check.height > limits.maxSide) return { ok: false, error: `Avatars must be at most ${limits.maxSide} pixels on each side.` };
  if (check.width < limits.minSide || check.height < limits.minSide) return { ok: false, error: `Avatars must be at least ${limits.minSide} pixels on each side.` };
  try {
    const bytes = await sharp(input, { limitInputPixels: limits.maxSide * limits.maxSide, failOn: "error", animated: false })
      .rotate()
      .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: "cover", position: "attention", withoutEnlargement: false })
      .webp({ quality: 82 })
      .toBuffer();
    return { ok: true, bytes, contentType: "image/webp" };
  } catch {
    return { ok: false, error: "That image could not be processed. Try a different file." };
  }
}
