import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { unseal, type Sealed } from "./secrets";

/**
 * The S3 bucket media used before the move to Cloudflare R2 (setting "storage"). Read-only: it serves
 * rows not yet migrated and is the source for the migration tool. Nothing new is ever written here.
 */
export const LEGACY_STORAGE_KEY = "storage";

export type LegacyStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: Sealed;
  verifiedAt: string | null;
};

export async function readLegacyConfig(): Promise<LegacyStorageConfig | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, LEGACY_STORAGE_KEY));
  return (row?.value as LegacyStorageConfig | undefined) ?? null;
}

let client: { key: string; s3: S3Client } | undefined;

function s3For(c: LegacyStorageConfig): S3Client {
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

export async function legacyClient(): Promise<{ s3: S3Client; bucket: string } | null> {
  const c = await readLegacyConfig();
  return c ? { s3: s3For(c), bucket: c.bucket } : null;
}

export async function legacyHead(key: string): Promise<{ size: number; contentType?: string } | null> {
  const c = await legacyClient();
  if (!c) return null;
  try {
    const r = await c.s3.send(new HeadObjectCommand({ Bucket: c.bucket, Key: key }));
    return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
  } catch {
    return null;
  }
}

export async function legacyGet(key: string, range?: string) {
  const c = await legacyClient();
  if (!c) return null;
  try {
    return await c.s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: key, ...(range ? { Range: range } : {}) }));
  } catch {
    return null;
  }
}
