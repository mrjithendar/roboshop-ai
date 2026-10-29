import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import type { Actor } from "@/lib/posts";
import { fakeR2, PNG_1x1 } from "./fake-r2";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
const r2 = fakeR2();
vi.mock("@/lib/storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/storage")>()), ...r2 }));
const legacy = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), configured: true, deletes: 0 }));
vi.mock("@/lib/storage-legacy", () => ({
  readLegacyConfig: async () => (legacy.configured ? { bucket: "old-s3" } : null),
  legacyGet: async (key: string) => {
    const b = legacy.objects.get(key);
    return b ? { Body: { transformToByteArray: async () => new Uint8Array(b), transformToWebStream: () => new Blob([new Uint8Array(b)]).stream() }, ContentLength: b.length } : null;
  },
}));

const { migrateBatch, migrationManifest, migrationStatus, rollbackMigration } = await import("@/lib/media-migration");
const { GET: mediaRoute } = await import("@/app/media/[id]/[name]/route");

const admin: Actor = { id: "admin", role: "admin", label: "admin@example.com" };
const author: Actor = { id: "author", role: "author", label: "a@example.com" };
const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

let db: Db;
beforeEach(async () => {
  r2.objects.clear();
  legacy.objects.clear();
  legacy.configured = true;
  db = await freshDb();
  await db.insert(schema.user).values({ id: "admin", name: "A", email: admin.label, role: "admin" });
  for (const [i, id] of IDS.entries()) {
    const key = `site/media/2025/0${i + 1}/library/pic-${i}-${id.slice(0, 8)}.png`;
    legacy.objects.set(key, PNG_1x1);
    // Rows created before R2 (as migration 0004 marks them).
    await db.insert(schema.media).values({ id, filename: `pic-${i}.png`, contentType: "image/png", storageKey: key, storageBackend: "s3-legacy", sizeBytes: PNG_1x1.length, width: 1, height: 1, alt: "x", createdAt: new Date(`2025-0${i + 1}-15T00:00:00Z`) });
  }
});
afterEach(() => setDbForTests(undefined));

describe("S3 → R2 media migration", () => {
  it("serves legacy rows from the old bucket until they are migrated", async () => {
    const res = await mediaRoute(new Request("https://jithendar.com/x"), { params: Promise.resolve({ id: IDS[0]!, name: "pic-0.png" }) });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_1x1)).toBe(true);
  });

  it("dry run plans keys in the R2 structure (keeping the original month) and changes nothing", async () => {
    const { entries, remaining } = await migrateBatch(admin, { dryRun: true });
    expect(entries.map((e) => e.newKey)).toEqual([`jithendar/www/media/images/2025/01/${IDS[0]}.png`, `jithendar/www/media/images/2025/02/${IDS[1]}.png`]);
    expect(entries.every((e) => e.status === "would copy")).toBe(true);
    expect(remaining).toBe(2);
    expect(r2.objects.size).toBe(0);
  });

  it("copies, verifies and switches rows; is resumable and idempotent; never deletes the source", async () => {
    await expect(migrateBatch(author, { dryRun: false })).rejects.toMatchObject({ status: 403 });
    const first = await migrateBatch(admin, { dryRun: false, limit: 1 });
    expect(first.entries[0]!.status).toBe("copied");
    expect(first.remaining).toBe(1);
    const second = await migrateBatch(admin, { dryRun: false });
    expect(second.entries.map((e) => e.id)).toEqual([IDS[1]]);
    expect((await migrateBatch(admin, { dryRun: false })).entries).toHaveLength(0);
    expect(await migrationStatus()).toEqual({ legacy: 0, migrated: 2, sourceConfigured: true });
    expect(legacy.objects.size).toBe(2);

    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, IDS[0]!));
    expect(row).toMatchObject({ storageBackend: "r2", storageKey: `jithendar/www/media/images/2025/01/${IDS[0]}.png`, legacyKey: expect.stringContaining("site/media/2025/01") });
    expect(row!.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    // The public URL is unchanged, so no post or page needs rewriting.
    const res = await mediaRoute(new Request("https://jithendar.com/x"), { params: Promise.resolve({ id: IDS[0]!, name: "pic-0.png" }) });
    expect(res.status).toBe(200);

    const manifest = await migrationManifest();
    expect(manifest).toHaveLength(2);
    expect(manifest[0]).toMatchObject({ url: `/media/${IDS[0]}/pic-0.png`, oldKey: row!.legacyKey, newKey: row!.storageKey, status: "migrated" });
  });

  it("skips the upload when a previous interrupted run already copied the object", async () => {
    await r2.putObject(`jithendar/www/media/images/2025/01/${IDS[0]}.png`, PNG_1x1, { contentType: "image/png" });
    const { entries } = await migrateBatch(admin, { dryRun: false, limit: 1 });
    expect(entries[0]!.status).toBe("already in R2, switched");
  });

  it("reports a missing or corrupt source without switching the row", async () => {
    legacy.objects.clear();
    const { entries } = await migrateBatch(admin, { dryRun: false });
    expect(entries.every((e) => e.status.startsWith("failed"))).toBe(true);
    expect((await migrationStatus()).legacy).toBe(2);
  });

  it("rolls back by pointing rows at their S3 objects again", async () => {
    await migrateBatch(admin, { dryRun: false });
    expect(await rollbackMigration(admin)).toBe(2);
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, IDS[0]!));
    expect(row).toMatchObject({ storageBackend: "s3-legacy", legacyKey: null, storageKey: expect.stringContaining("site/media/2025/01") });
    // Migrating again is safe: the R2 copies are reused.
    const again = await migrateBatch(admin, { dryRun: false });
    expect(again.entries.every((e) => e.status === "already in R2, switched")).toBe(true);
  });
});
