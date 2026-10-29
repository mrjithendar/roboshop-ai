import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { seal, unseal, type Sealed } from "./secrets";

/**
 * Media storage: one Cloudflare R2 bucket through its S3-compatible API.
 *
 *   jithendar/www/media/{kind}/{yyyy}/{mm}/{unique-id}.{ext}   uploaded and accepted media
 *   jithendar/www/tmp/generated/{yyyy}/{mm}/{id}.{ext}         unaccepted AI images (expire after a day)
 *
 * These are object-key prefixes inside the configured bucket. The authenticated API endpoint
 * (https://<account>.r2.cloudflarestorage.com) is only used server-side; readers get media from
 * /media/{id}/{name} on this site, or from R2_PUBLIC_BASE_URL (a custom domain on the bucket) for
 * large files. Configuration comes from R2_* environment variables (the Kubernetes Secret) or, when
 * those are absent, from Admin → Storage (credentials sealed in the database).
 */
export const MEDIA_ROOT = "jithendar/www/media";
export const TMP_ROOT = "jithendar/www/tmp";
export const MEDIA_KINDS = ["images", "videos", "audio", "documents"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Uniquely named objects never change, so they are cached for a year. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

const SETTING_KEY = "storage.r2";

function yyyymm(now: Date): [string, string] {
  return [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0")];
}

const EXT = /^[a-z0-9]{1,5}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** jithendar/www/media/{kind}/{yyyy}/{mm}/{id}.{ext}: the id is a random UUID, never a user-supplied name. */
export function mediaObjectKey(kind: MediaKind, id: string, ext: string, now = new Date()): string {
  if (!MEDIA_KINDS.includes(kind)) throw new Error(`unknown media kind: ${kind}`);
  if (!ID.test(id)) throw new Error("media id must be a UUID");
  if (!EXT.test(ext)) throw new Error("invalid extension");
  const [yyyy, mm] = yyyymm(now);
  return `${MEDIA_ROOT}/${kind}/${yyyy}/${mm}/${id}.${ext}`;
}

export function tempObjectKey(id: string, ext: string, now = new Date()): string {
  if (!ID.test(id) || !EXT.test(ext)) throw new Error("invalid temporary key");
  const [yyyy, mm] = yyyymm(now);
  return `${TMP_ROOT}/generated/${yyyy}/${mm}/${id}.${ext}`;
}

// --- Configuration --------------------------------------------------------------------------

type StoredR2 = {
  accountId: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: Sealed;
  publicBaseUrl: string;
  verifiedAt: string | null;
};

export type R2Config = {
  source: "env" | "admin";
  accountId: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: () => string;
  /** Public delivery base (custom domain or r2.dev), no trailing slash; "" when the bucket is private. */
  publicBaseUrl: string;
  verifiedAt: string | null;
};

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function endpointFor(accountId: string, override = ""): string {
  return override.replace(/\/+$/, "") || `https://${accountId}.r2.cloudflarestorage.com`;
}

function envConfig(): R2Config | null {
  const e = process.env;
  if (!e.R2_ACCOUNT_ID && !e.R2_BUCKET && !e.R2_ACCESS_KEY_ID) return null;
  const missing = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter((k) => !e[k]);
  if (missing.length) throw new Error(`R2 is partly configured; missing ${missing.join(", ")}`);
  const secret = e.R2_SECRET_ACCESS_KEY!;
  return {
    source: "env",
    accountId: e.R2_ACCOUNT_ID!,
    endpoint: endpointFor(e.R2_ACCOUNT_ID!, e.R2_ENDPOINT),
    bucket: e.R2_BUCKET!,
    accessKeyId: e.R2_ACCESS_KEY_ID!,
    secretAccessKey: () => secret,
    publicBaseUrl: (e.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
    // Environment configuration is trusted at start-up; Admin → System status checks it live.
    verifiedAt: "env",
  };
}

async function storedConfig(): Promise<StoredR2 | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, SETTING_KEY));
  return (row?.value as StoredR2 | undefined) ?? null;
}

export async function readR2Config(): Promise<R2Config | null> {
  const env = envConfig();
  if (env) return env;
  const c = await storedConfig();
  if (!c) return null;
  return { ...c, source: "admin", endpoint: endpointFor(c.accountId, c.endpoint), secretAccessKey: () => unseal(c.secretAccessKey) };
}

/** Safe view for the admin form and status page: never includes the secret. */
export async function storageSummary() {
  const c = await readR2Config();
  if (!c) return null;
  return { source: c.source, accountId: c.accountId, endpoint: c.endpoint, bucket: c.bucket, accessKeyId: c.accessKeyId, publicBaseUrl: c.publicBaseUrl, verifiedAt: c.verifiedAt };
}

export async function storageReady(): Promise<boolean> {
  return Boolean((await readR2Config())?.verifiedAt);
}

export const storageInput = z.object({
  accountId: z.string().trim().toLowerCase().regex(ACCOUNT_ID, "the 32-character account ID from the Cloudflare dashboard"),
  /** Optional: a jurisdiction endpoint (e.g. https://<account>.eu.r2.cloudflarestorage.com) or a local S3 emulator. */
  endpoint: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).default(""),
  bucket: z.string().trim().regex(BUCKET, "not a valid R2 bucket name"),
  publicBaseUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ })]).default(""),
  accessKeyId: z.string().trim().min(3).max(200),
  /** Blank keeps the stored secret. */
  secretAccessKey: z.string().max(400).default(""),
});

// --- Client ---------------------------------------------------------------------------------

let cached: { key: string; s3: S3Client } | undefined;

function clientFor(c: R2Config): S3Client {
  const secret = c.secretAccessKey();
  const key = JSON.stringify([c.endpoint, c.accessKeyId, secret]);
  if (cached?.key === key) return cached.s3;
  const s3 = new S3Client({
    region: "auto", // required by the SDK, ignored by R2
    endpoint: c.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: secret },
    // Send checksums only where an operation requires them; we send Content-MD5 ourselves on uploads.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  cached = { key, s3 };
  return s3;
}

async function requireR2(): Promise<{ c: R2Config; s3: S3Client }> {
  const c = await readR2Config();
  if (!c?.verifiedAt) throw new PostError("Media storage (Cloudflare R2) is not configured. An admin must set it up under Admin → Storage first.", 409);
  return { c, s3: clientFor(c) };
}

export type ObjectInfo = { size: number; contentType?: string; etag?: string };

export async function putObject(key: string, body: Buffer, opts: { contentType: string; cacheControl?: string; contentMd5?: string }) {
  const { c, s3 } = await requireR2();
  await s3.send(
    new PutObjectCommand({
      Bucket: c.bucket,
      Key: key,
      Body: body,
      ContentType: opts.contentType,
      CacheControl: opts.cacheControl ?? IMMUTABLE,
      // R2 rejects the upload if the bytes it received do not match.
      ContentMD5: opts.contentMd5,
    }),
  );
}

export async function headObject(key: string): Promise<ObjectInfo | null> {
  const { c, s3 } = await requireR2();
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: c.bucket, Key: key }));
    return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType, etag: r.ETag };
  } catch (e) {
    if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

/** Streamed read, optionally a byte range ("bytes=0-1023"). null if the object does not exist. */
export async function getObject(key: string, range?: string) {
  const { c, s3 } = await requireR2();
  try {
    return await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: key, ...(range ? { Range: range } : {}) }));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 416) return null;
    throw e;
  }
}

/** Whole object as bytes, refusing anything larger than `maxBytes`. */
export async function getObjectBytes(key: string, maxBytes: number): Promise<Buffer | null> {
  const res = await getObject(key);
  if (!res?.Body) return null;
  if (Number(res.ContentLength ?? 0) > maxBytes) throw new PostError("The stored file is larger than allowed.", 413);
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function deleteObject(key: string) {
  const { c, s3 } = await requireR2();
  await s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key }));
}

export async function copyObject(from: string, to: string, opts: { contentType: string; cacheControl?: string }) {
  const { c, s3 } = await requireR2();
  await s3.send(
    new CopyObjectCommand({
      Bucket: c.bucket,
      Key: to,
      CopySource: `${c.bucket}/${from.split("/").map(encodeURIComponent).join("/")}`,
      MetadataDirective: "REPLACE",
      ContentType: opts.contentType,
      CacheControl: opts.cacheControl ?? IMMUTABLE,
    }),
  );
}

export async function listObjects(prefix: string, continuationToken?: string, maxKeys = 100) {
  const { c, s3 } = await requireR2();
  const r = await s3.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: prefix, ContinuationToken: continuationToken, MaxKeys: Math.min(maxKeys, 1000) }));
  return {
    objects: (r.Contents ?? []).map((o) => ({ key: o.Key!, size: Number(o.Size ?? 0), lastModified: o.LastModified?.toISOString() ?? null })),
    next: r.IsTruncated ? r.NextContinuationToken : undefined,
  };
}

/**
 * Short-lived URL the browser PUTs one file to. Content-Type and Content-Length are part of the
 * signature, so the upload fails unless it is exactly the declared type and size.
 */
export async function presignPut(key: string, contentType: string, contentLength: number, expiresIn = 600): Promise<string> {
  const { c, s3 } = await requireR2();
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: c.bucket, Key: key, ContentType: contentType, ContentLength: contentLength, CacheControl: IMMUTABLE }),
    { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
  );
}

/** Short-lived download link for private media. */
export async function presignGet(key: string, filename: string, expiresIn = 300): Promise<string> {
  const { c, s3 } = await requireR2();
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: c.bucket, Key: key, ResponseContentDisposition: `inline; filename="${filename.replace(/["\\]/g, "")}"`, ResponseCacheControl: "private, no-store" }),
    { expiresIn },
  );
}

/** Public URL of an object on the configured delivery domain, or null when the bucket is not public. */
export async function publicObjectUrl(key: string): Promise<string | null> {
  const c = await readR2Config();
  if (!c?.publicBaseUrl) return null;
  return `${c.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// --- Admin configuration ----------------------------------------------------------------------

/** A write, read-back and delete under the tmp prefix proves the credentials and bucket work. */
async function probe(c: R2Config) {
  const s3 = clientFor(c);
  const Key = `${TMP_ROOT}/.storage-check-${crypto.randomUUID()}`;
  await s3.send(new PutObjectCommand({ Bucket: c.bucket, Key, Body: "ok", ContentType: "text/plain" }));
  const got = await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key }));
  const body = await got.Body?.transformToString();
  await s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key }));
  if (body !== "ok") throw new Error("read-back did not match");
}

/** Save the configuration, then prove it works. Uploads stay disabled until it does. */
export async function saveStorageConfig(actor: Actor, raw: unknown): Promise<{ verified: boolean; error?: string }> {
  if (actor.role !== "admin") throw new PostError("Only admins can configure storage.", 403);
  if (envConfig()) throw new PostError("Storage is configured by R2_* environment variables (the Kubernetes Secret). Change it there.", 409);
  const parsed = storageInput.safeParse(raw);
  if (!parsed.success) throw new PostError("The storage settings are not valid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const input = parsed.data;
  const existing = await storedConfig();
  if (!input.secretAccessKey && !existing) throw new PostError("Enter the secret access key.", 400);
  const stored: StoredR2 = {
    accountId: input.accountId,
    endpoint: input.endpoint,
    bucket: input.bucket,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey ? seal(input.secretAccessKey) : existing!.secretAccessKey,
    publicBaseUrl: input.publicBaseUrl.replace(/\/+$/, ""),
    verifiedAt: null,
  };
  let error: string | undefined;
  try {
    await probe({ ...stored, source: "admin", endpoint: endpointFor(stored.accountId, stored.endpoint), secretAccessKey: () => unseal(stored.secretAccessKey) });
    stored.verifiedAt = new Date().toISOString();
  } catch (e) {
    error = (e as Error).message;
  }
  const db = await getDb();
  await db
    .insert(schema.setting)
    .values({ key: SETTING_KEY, value: stored, updatedBy: actor.id })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: stored, updatedBy: actor.id, updatedAt: new Date() } });
  await audit(actor, "storage.configure", stored.bucket, { provider: "r2", verified: !error });
  return { verified: !error, error };
}

/** Status check for Admin → System status: list one key under the media prefix. */
export async function checkStorage(): Promise<{ status: "ok" | "degraded" | "not configured"; detail: string }> {
  const c = await readR2Config();
  if (!c) return { status: "not configured", detail: "uploads disabled until R2 is configured" };
  const s3 = clientFor(c);
  await s3.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: `${MEDIA_ROOT}/`, MaxKeys: 1 }));
  return {
    status: c.verifiedAt ? "ok" : "degraded",
    detail: `R2 bucket ${c.bucket} (${c.source === "env" ? "from Secret" : "from admin"})${c.publicBaseUrl ? ` · public ${new URL(c.publicBaseUrl).host}` : " · served through the site"}${c.verifiedAt ? "" : " · not verified"}`,
  };
}

/** Context folder kept on the media row for organisation in the admin (not part of the object key). */
const CONTEXT = /^(library|generated|pages\/[a-z0-9-]+|authors\/[a-z0-9-]+|posts\/(blog|news|projects)\/[a-z0-9-]+)$/;

export function normaliseContext(value: string | null | undefined): string {
  return value && CONTEXT.test(value) ? value : "library";
}
