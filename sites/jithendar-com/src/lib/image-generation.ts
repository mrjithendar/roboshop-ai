import { createHash } from "node:crypto";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FeaturedImage } from "@/db/schema";
import { rowsOf } from "@/db/rows";
import { audit } from "./audit";
import { ASPECT_RATIOS, generateImage, geminiImageConfig, ImageGenError, type AspectRatio, type GeminiImageConfig } from "./gemini";
import { log } from "./log";
import { inspectImage, mediaSrc, recordImage, sanitizeFilename } from "./media";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { copyObject, deleteObject, getObject, headObject, mediaObjectKey, putObject, storageReady, tempObjectKey } from "./storage";

/**
 * "Generate image" for the editor.
 *
 * Flow: generate → (validated) temporary object under jithendar/www/tmp/generated/ → the author previews
 * it → accept (copied to jithendar/www/media/images/…, media row created, returned as the cover) or
 * discard (deleted). Results not accepted within RESULT_TTL are deleted by expireGenerations(), which
 * runs before every generation and from Admin → Database; an R2 lifecycle rule on the tmp prefix
 * (docs/MEDIA.md) is the backstop. Nothing is ever attached or published without the author accepting.
 */
export const RESULT_TTL_MS = 60 * 60 * 1000;
const PROMPT_MIN = 10;
const PROMPT_MAX = 2_000;

export type GenerationLimits = { perUserHourly: number; dailyTotal: number; perUserConcurrent: number };

export function generationLimits(env: Record<string, string | undefined> = process.env): GenerationLimits {
  const n = (v: string | undefined, d: number, max: number) => Math.min(Math.max(Math.floor(Number(v) || d), 0), max);
  return {
    perUserHourly: n(env.GEMINI_IMAGE_USER_HOURLY_LIMIT, 10, 1_000),
    dailyTotal: n(env.GEMINI_IMAGE_DAILY_LIMIT, 50, 10_000),
    perUserConcurrent: Math.max(n(env.GEMINI_IMAGE_USER_CONCURRENCY, 1, 5), 1),
  };
}

/** For the editor: whether to show the button (configured + storage ready). Never exposes keys. */
export async function imageGenerationStatus(): Promise<{ enabled: boolean; reason?: string; aspectRatios: readonly AspectRatio[] }> {
  if (!geminiImageConfig()) return { enabled: false, reason: "Image generation is not configured (GEMINI_API_KEY and GEMINI_IMAGE_MODEL).", aspectRatios: ASPECT_RATIOS };
  if (!(await storageReady())) return { enabled: false, reason: "Configure media storage (R2) first.", aspectRatios: ASPECT_RATIOS };
  return { enabled: true, aspectRatios: ASPECT_RATIOS };
}

const staff = (a: Actor) => a.role === "admin" || a.role === "author";

async function count(where: ReturnType<typeof sql>): Promise<number> {
  const db = await getDb();
  const [r] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from image_generation where ${where}`));
  return Number(r?.n ?? 0);
}

export type GenerationResult = { id: string; previewUrl: string; width: number; height: number; model: string; expiresAt: string };

export async function startGeneration(
  actor: Actor,
  input: { prompt?: unknown; aspectRatio?: unknown },
  opts: { signal?: AbortSignal; config?: GeminiImageConfig | null; fetchImpl?: typeof fetch; limits?: GenerationLimits; now?: number } = {},
): Promise<GenerationResult> {
  if (!staff(actor)) throw new PostError("Not allowed.", 403);
  const config = opts.config === undefined ? geminiImageConfig() : opts.config;
  if (!config) throw new PostError("Image generation is not configured.", 503);
  if (!(await storageReady())) throw new PostError("Media storage (Cloudflare R2) is not configured.", 409);
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < PROMPT_MIN || prompt.length > PROMPT_MAX) throw new PostError(`The prompt must be ${PROMPT_MIN}–${PROMPT_MAX} characters.`, 400);
  const aspectRatio = ASPECT_RATIOS.find((r) => r === input.aspectRatio);
  if (!aspectRatio) throw new PostError(`Choose an aspect ratio: ${ASPECT_RATIOS.join(", ")}.`, 400);

  const now = opts.now ?? Date.now();
  await expireGenerations(now).catch((e) => log.warn("expiring generations failed", { err: e }));
  const limits = opts.limits ?? generationLimits();
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const runningSince = new Date(now - config.timeoutMs - 30_000).toISOString();
  const counted = sql`status not in ('rejected')`;
  if ((await count(sql`user_id = ${actor.id} and created_at > ${hourAgo} and ${counted}`)) >= limits.perUserHourly)
    throw new PostError(`You have reached the limit of ${limits.perUserHourly} generated images per hour. Try again later.`, 429);
  if ((await count(sql`created_at > ${dayAgo} and ${counted}`)) >= limits.dailyTotal)
    throw new PostError(`The site's daily limit of ${limits.dailyTotal} generated images has been reached. Try again tomorrow.`, 429);
  if ((await count(sql`user_id = ${actor.id} and status = 'running' and created_at > ${runningSince}`)) >= limits.perUserConcurrent)
    throw new PostError("An image is already being generated. Wait for it to finish or cancel it.", 409);

  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.imageGeneration).values({
    id,
    userId: actor.id,
    model: config.model,
    aspectRatio,
    imageSize: config.imageSize,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
    promptChars: prompt.length,
    status: "running",
    createdAt: new Date(now),
  });
  // Two requests racing past the check above: both see each other here, and the later one stands down.
  if ((await count(sql`user_id = ${actor.id} and status = 'running' and created_at > ${runningSince}`)) > limits.perUserConcurrent) {
    await db.update(schema.imageGeneration).set({ status: "rejected", errorCode: "concurrency", completedAt: new Date() }).where(eq(schema.imageGeneration.id, id));
    throw new PostError("An image is already being generated. Wait for it to finish or cancel it.", 409);
  }

  const started = Date.now();
  const fail = async (code: string, status = "failed") =>
    db.update(schema.imageGeneration).set({ status, errorCode: code, latencyMs: Date.now() - started, completedAt: new Date() }).where(eq(schema.imageGeneration.id, id));

  let bytes: Buffer;
  let declared: string;
  try {
    const out = await generateImage(config, { prompt, aspectRatio, signal: opts.signal }, opts.fetchImpl);
    bytes = out.bytes;
    declared = out.mimeType;
  } catch (e) {
    const err = e instanceof ImageGenError ? e : new ImageGenError("unavailable", 503, (e as Error).message);
    await fail(err.code, err.code === "cancelled" ? "cancelled" : "failed");
    log.warn("image generation failed", { generationId: id, model: config.model, code: err.code, detail: err.detail });
    throw new PostError(err.message, err.status);
  }

  // Never store what we have not verified: an allowed raster format, decodable, within size limits.
  const check = inspectImage(bytes);
  if (!check.ok || !["image/jpeg", "image/png", "image/webp"].includes(check.contentType) || (declared && declared !== check.contentType && declared !== "image/jpeg")) {
    await fail("invalid_image");
    throw new PostError(new ImageGenError("invalid_image", 502).message, 502);
  }
  const tempKey = tempObjectKey(id, check.ext);
  await putObject(tempKey, bytes, { contentType: check.contentType, cacheControl: "private, no-store", contentMd5: createHash("md5").update(bytes).digest("base64") });
  const latencyMs = Date.now() - started;
  await db
    .update(schema.imageGeneration)
    .set({
      status: "succeeded",
      tempKey,
      contentType: check.contentType,
      sizeBytes: bytes.length,
      width: check.width,
      height: check.height,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      latencyMs,
      completedAt: new Date(),
    })
    .where(eq(schema.imageGeneration.id, id));
  log.info("image generated", { generationId: id, model: config.model, aspectRatio, latencyMs, bytes: bytes.length });
  return {
    id,
    previewUrl: `/api/admin/images/generations/${id}`,
    width: check.width,
    height: check.height,
    model: config.model,
    expiresAt: new Date(Date.now() + RESULT_TTL_MS).toISOString(),
  };
}

async function ownGeneration(actor: Actor, id: string) {
  if (!staff(actor)) throw new PostError("Not allowed.", 403);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new PostError("Generated image not found.", 404);
  const db = await getDb();
  const [row] = await db.select().from(schema.imageGeneration).where(eq(schema.imageGeneration.id, id));
  if (!row || (row.userId !== actor.id && actor.role !== "admin")) throw new PostError("Generated image not found.", 404);
  return row;
}

/** Bytes of an unaccepted result, for the preview in the dialog. */
export async function generationPreview(actor: Actor, id: string) {
  const row = await ownGeneration(actor, id);
  if (row.status !== "succeeded" || !row.tempKey) throw new PostError("This generated image has expired. Generate a new one.", 410);
  const obj = await getObject(row.tempKey);
  if (!obj?.Body) throw new PostError("This generated image has expired. Generate a new one.", 410);
  return { body: obj.Body.transformToWebStream(), contentType: row.contentType ?? "image/jpeg" };
}

/**
 * The author accepted the image: copy it into the media library and return it as a cover.
 * The caller only puts it in the editor; the post changes when the author saves.
 */
export async function acceptGeneration(actor: Actor, id: string, input: { alt: unknown; context?: unknown; name?: unknown }): Promise<FeaturedImage & { id: string }> {
  const row = await ownGeneration(actor, id);
  const alt = typeof input.alt === "string" ? input.alt.trim() : "";
  if (!alt || alt.length > 300) throw new PostError("Describe the image in the alt text (up to 300 characters).", 400);
  const db = await getDb();
  // Claim the row so a double click cannot create two media items.
  const [claimed] = await db
    .update(schema.imageGeneration)
    .set({ status: "accepting" })
    .where(and(eq(schema.imageGeneration.id, id), eq(schema.imageGeneration.status, "succeeded")))
    .returning();
  if (!claimed?.tempKey || !row.width || !row.height || !row.contentType || !row.sizeBytes || !row.checksumSha256) {
    throw new PostError(row.status === "accepted" ? "This image was already added to the media library." : "This generated image has expired. Generate a new one.", 410);
  }
  const mediaId = crypto.randomUUID();
  const ext = row.contentType === "image/png" ? "png" : row.contentType === "image/webp" ? "webp" : "jpg";
  const key = mediaObjectKey("images", mediaId, ext);
  try {
    await copyObject(claimed.tempKey, key, { contentType: row.contentType });
    const head = await headObject(key);
    if (!head || head.size !== row.sizeBytes) throw new Error("copied object does not match");
    const filename = sanitizeFilename(typeof input.name === "string" && input.name ? input.name : "generated-image", ext);
    await recordImage({
      id: mediaId,
      filename,
      storageKey: key,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      alt,
      checksumSha256: row.checksumSha256,
      context: typeof input.context === "string" ? input.context : "generated",
      userId: actor.id,
    });
    await db.update(schema.imageGeneration).set({ status: "accepted", mediaId, tempKey: null }).where(eq(schema.imageGeneration.id, id));
    await deleteObject(claimed.tempKey).catch(() => undefined);
    await audit(actor, "media.generate.accept", mediaId, { generationId: id, model: row.model });
    return { id: mediaId, src: mediaSrc({ id: mediaId, filename }), alt, width: row.width, height: row.height };
  } catch (e) {
    await db.update(schema.imageGeneration).set({ status: "succeeded" }).where(eq(schema.imageGeneration.id, id));
    log.error("accepting generated image failed", { generationId: id, err: e });
    throw new PostError("The image could not be saved to the media library. Try again.", 502);
  }
}

export async function discardGeneration(actor: Actor, id: string): Promise<void> {
  const row = await ownGeneration(actor, id);
  if (row.status !== "succeeded") return;
  if (row.tempKey) await deleteObject(row.tempKey).catch(() => undefined);
  const db = await getDb();
  await db.update(schema.imageGeneration).set({ status: "discarded", tempKey: null }).where(and(eq(schema.imageGeneration.id, id), eq(schema.imageGeneration.status, "succeeded")));
}

/** Delete results nobody accepted within RESULT_TTL, and close out requests that never finished. */
export async function expireGenerations(now = Date.now()): Promise<number> {
  const db = await getDb();
  const old = await db
    .select({ id: schema.imageGeneration.id, tempKey: schema.imageGeneration.tempKey })
    .from(schema.imageGeneration)
    .where(and(eq(schema.imageGeneration.status, "succeeded"), lt(schema.imageGeneration.completedAt, new Date(now - RESULT_TTL_MS))))
    .limit(50);
  for (const g of old) {
    if (g.tempKey) await deleteObject(g.tempKey).catch(() => undefined);
  }
  if (old.length) {
    await db.update(schema.imageGeneration).set({ status: "expired", tempKey: null }).where(inArray(schema.imageGeneration.id, old.map((g) => g.id)));
  }
  await db
    .update(schema.imageGeneration)
    .set({ status: "failed", errorCode: "abandoned", completedAt: new Date(now) })
    .where(and(inArray(schema.imageGeneration.status, ["running", "accepting"]), lt(schema.imageGeneration.createdAt, new Date(now - 15 * 60_000))));
  return old.length;
}

/** Usage for Admin → System status: generations in the last 24 hours by outcome. */
export async function generationUsage(now = Date.now()) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.imageGeneration.status, n: sql<number>`count(*)::int` })
    .from(schema.imageGeneration)
    .where(gt(schema.imageGeneration.createdAt, new Date(now - 86_400_000)))
    .groupBy(schema.imageGeneration.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
