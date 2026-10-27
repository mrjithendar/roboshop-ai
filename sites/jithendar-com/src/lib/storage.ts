import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { seal, unseal, type Sealed } from "./secrets";

/** Any S3-compatible service: AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi… */
const STORAGE_KEY = "storage";

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: Sealed;
  verifiedAt: string | null;
};

export const storageInput = z.object({
  endpoint: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).default(""),
  region: z.string().trim().min(1).max(40).default("us-east-1"),
  bucket: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "not a valid bucket name"),
  prefix: z.string().trim().regex(/^[a-z0-9][a-z0-9/_-]{0,80}$|^$/, "letters, numbers, - _ and /").default(""),
  forcePathStyle: z.boolean().default(false),
  accessKeyId: z.string().trim().min(3).max(200),
  /** Blank keeps the stored secret. */
  secretAccessKey: z.string().max(400).default(""),
});

async function readConfig(): Promise<StorageConfig | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, STORAGE_KEY));
  return (row?.value as StorageConfig | undefined) ?? null;
}

/** Safe view for the admin form: never includes the secret. */
export async function storageSummary() {
  const c = await readConfig();
  if (!c) return null;
  const { secretAccessKey: _s, ...rest } = c;
  void _s;
  return { ...rest, hasSecret: true };
}

export async function storageReady(): Promise<boolean> {
  return Boolean((await readConfig())?.verifiedAt);
}

let client: { key: string; s3: S3Client } | undefined;

function s3For(c: StorageConfig): S3Client {
  const key = JSON.stringify([c.endpoint, c.region, c.bucket, c.accessKeyId, c.secretAccessKey.data, c.forcePathStyle]);
  if (client?.key === key) return client.s3;
  const s3 = new S3Client({
    region: c.region,
    ...(c.endpoint ? { endpoint: c.endpoint } : {}),
    forcePathStyle: c.forcePathStyle,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: unseal(c.secretAccessKey) },
  });
  client = { key, s3 };
  return s3;
}

async function probe(c: StorageConfig) {
  const s3 = s3For(c);
  const Key = `${c.prefix ? `${c.prefix}/` : ""}.jithendar-storage-check-${Date.now()}`;
  await s3.send(new PutObjectCommand({ Bucket: c.bucket, Key, Body: "ok", ContentType: "text/plain" }));
  const got = await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key }));
  const body = await got.Body?.transformToString();
  await s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key }));
  if (body !== "ok") throw new Error("read-back did not match");
}

/** Save the configuration, then prove it works (write, read, delete). Uploads stay disabled until it does. */
export async function saveStorageConfig(actor: Actor, raw: unknown): Promise<{ verified: boolean; error?: string }> {
  if (actor.role !== "admin") throw new PostError("Only admins can configure storage.", 403);
  const parsed = storageInput.safeParse(raw);
  if (!parsed.success) throw new PostError("The storage settings are not valid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const input = parsed.data;
  const existing = await readConfig();
  if (!input.secretAccessKey && !existing) throw new PostError("Enter the secret access key.", 400);
  const config: StorageConfig = {
    endpoint: input.endpoint,
    region: input.region,
    bucket: input.bucket,
    prefix: input.prefix.replace(/\/+$/, ""),
    forcePathStyle: input.forcePathStyle,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey ? seal(input.secretAccessKey) : existing!.secretAccessKey,
    verifiedAt: null,
  };
  let error: string | undefined;
  try {
    await probe(config);
    config.verifiedAt = new Date().toISOString();
  } catch (e) {
    error = (e as Error).message;
  }
  const db = await getDb();
  await db
    .insert(schema.setting)
    .values({ key: STORAGE_KEY, value: config, updatedBy: actor.id })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: config, updatedBy: actor.id, updatedAt: new Date() } });
  await audit(actor, "storage.configure", config.bucket, { endpoint: config.endpoint || "aws", verified: !error });
  return { verified: !error, error };
}

async function requireConfig(): Promise<StorageConfig> {
  const c = await readConfig();
  if (!c?.verifiedAt) throw new PostError("Media storage (S3) is not configured. An admin must set it up under Admin → Storage before images can be uploaded.", 409);
  return c;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  const c = await requireConfig();
  await s3For(c).send(
    new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }),
  );
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const c = await readConfig();
  if (!c) return null;
  try {
    const res = await s3For(c).send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
    return (await res.Body?.transformToByteArray()) ?? null;
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  const c = await requireConfig();
  await s3For(c).send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key }));
}

/** media/<yyyy>/<mm>/<context>/<name>-<shortid>.<ext>, under the configured prefix. */
export async function mediaObjectKey(context: string, filename: string, id: string, now = new Date()): Promise<string> {
  const c = await requireConfig();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dot = filename.lastIndexOf(".");
  const base = filename.slice(0, dot);
  const ext = filename.slice(dot + 1);
  return [c.prefix, "media", yyyy, mm, context, `${base}-${id.slice(0, 8)}.${ext}`].filter(Boolean).join("/");
}

const CONTEXT = /^(library|pages\/[a-z0-9-]+|authors\/[a-z0-9-]+|posts\/(blog|news|projects)\/[a-z0-9-]+)$/;

/** Folder context for an upload; anything unexpected goes to the general library. */
export function normaliseContext(value: string | null | undefined): string {
  return value && CONTEXT.test(value) ? value : "library";
}
