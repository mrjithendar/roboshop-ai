import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { rowsOf } from "@/db/rows";
import { audit } from "./audit";
import { kindOf, MEDIA_RULES } from "./media";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { headObject, mediaObjectKey, publicObjectUrl, putObject, storageReady, type MediaKind } from "./storage";
import { legacyGet, readLegacyConfig } from "./storage-legacy";

/**
 * Copy media from the legacy S3 bucket to R2.
 *
 * - Idempotent and resumable: each run handles the next batch of rows still marked "s3-legacy";
 *   an object already in R2 with the right size is not uploaded again.
 * - Verified: the copy is written with Content-MD5 (R2 rejects corrupted bytes), then its size is
 *   checked with HEAD before the row is switched.
 * - Non-destructive: source objects are never deleted; the old key is kept in media.legacy_key, so
 *   rollback() can point rows back at S3 at any time.
 * - References are unaffected: posts and pages link to /media/{id}/{filename}, which stays the same;
 *   only the row's storage location changes.
 */
export type ManifestEntry = { id: string; oldKey: string; newKey: string; url: string; publicUrl: string | null; bytes: number; status: string };

function extFor(contentType: string, filename: string): string {
  const kind = kindOf(contentType);
  return (kind && MEDIA_RULES[kind].types[contentType]) || filename.split(".").pop()!.toLowerCase();
}

export async function migrationStatus() {
  const db = await getDb();
  const [r] = rowsOf<{ legacy: number; migrated: number }>(
    await db.execute(sql`select count(*) filter (where storage_backend = 's3-legacy')::int as legacy,
                                count(*) filter (where storage_backend = 'r2' and legacy_key is not null)::int as migrated from media`),
  );
  return { legacy: Number(r?.legacy ?? 0), migrated: Number(r?.migrated ?? 0), sourceConfigured: Boolean(await readLegacyConfig()) };
}

export async function migrateBatch(actor: Actor, opts: { dryRun: boolean; limit?: number }): Promise<{ entries: ManifestEntry[]; remaining: number }> {
  if (actor.role !== "admin") throw new PostError("Only admins can migrate media.", 403);
  if (!(await storageReady())) throw new PostError("Configure Cloudflare R2 before migrating.", 409);
  if (!(await readLegacyConfig())) throw new PostError("No legacy S3 storage is configured, so there is nothing to copy from.", 409);
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const rows = await db.select().from(schema.media).where(eq(schema.media.storageBackend, "s3-legacy")).orderBy(asc(schema.media.createdAt)).limit(limit);
  const entries: ManifestEntry[] = [];
  for (const row of rows) {
    const kind = (kindOf(row.contentType) ?? row.kind) as MediaKind;
    const newKey = mediaObjectKey(kind, row.id, extFor(row.contentType, row.filename), row.createdAt);
    const base = { id: row.id, oldKey: row.storageKey, newKey, url: `/media/${row.id}/${row.filename}`, publicUrl: await publicObjectUrl(newKey), bytes: row.sizeBytes };
    if (opts.dryRun) {
      entries.push({ ...base, status: "would copy" });
      continue;
    }
    try {
      const existing = await headObject(newKey);
      let checksum = row.checksumSha256;
      if (!existing || existing.size !== row.sizeBytes) {
        const src = await legacyGet(row.storageKey);
        if (!src?.Body) throw new Error("source object missing");
        const bytes = Buffer.from(await src.Body.transformToByteArray());
        if (bytes.length !== row.sizeBytes) throw new Error(`source is ${bytes.length} bytes, expected ${row.sizeBytes}`);
        await putObject(newKey, bytes, { contentType: row.contentType, contentMd5: createHash("md5").update(bytes).digest("base64") });
        checksum = createHash("sha256").update(bytes).digest("hex");
        const copied = await headObject(newKey);
        if (copied?.size !== row.sizeBytes) throw new Error("copy verification failed (size)");
      }
      await db
        .update(schema.media)
        .set({ storageKey: newKey, storageBackend: "r2", legacyKey: row.storageKey, checksumSha256: checksum, kind })
        .where(and(eq(schema.media.id, row.id), eq(schema.media.storageBackend, "s3-legacy")));
      entries.push({ ...base, status: existing ? "already in R2, switched" : "copied" });
    } catch (e) {
      entries.push({ ...base, status: `failed: ${(e as Error).message}` });
    }
  }
  const { legacy } = await migrationStatus();
  if (!opts.dryRun) await audit(actor, "media.migrate", "r2", { processed: entries.length, failed: entries.filter((e) => e.status.startsWith("failed")).length, remaining: legacy });
  return { entries, remaining: legacy };
}

/** Old → new mapping for every migrated row (also the rollback record). */
export async function migrationManifest(): Promise<ManifestEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.media).where(isNotNull(schema.media.legacyKey)).orderBy(asc(schema.media.createdAt));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      oldKey: r.legacyKey!,
      newKey: r.storageKey,
      url: `/media/${r.id}/${r.filename}`,
      publicUrl: r.storageBackend === "r2" ? await publicObjectUrl(r.storageKey) : null,
      bytes: r.sizeBytes,
      status: r.storageBackend === "r2" ? "migrated" : "rolled back",
    })),
  );
}

/** Point migrated rows back at their S3 objects. The R2 copies stay (a later migration reuses them). */
export async function rollbackMigration(actor: Actor): Promise<number> {
  if (actor.role !== "admin") throw new PostError("Only admins can roll back the migration.", 403);
  if (!(await readLegacyConfig())) throw new PostError("The legacy S3 configuration is gone, so rows cannot point back at it.", 409);
  const db = await getDb();
  const rows = await db
    .update(schema.media)
    .set({ storageKey: sql`legacy_key`, storageBackend: "s3-legacy", legacyKey: null })
    .where(and(eq(schema.media.storageBackend, "r2"), isNotNull(schema.media.legacyKey)))
    .returning({ id: schema.media.id });
  await audit(actor, "media.migrate.rollback", "s3", { rows: rows.length });
  return rows.length;
}
