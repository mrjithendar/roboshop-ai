import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests, type Db } from "@/db";
import { buildBackup, saveGeneral } from "@/lib/backups";
import { browseTable, runMaintenance, tableStats } from "@/lib/db-admin";
import type { Actor } from "@/lib/posts";
import { decryptWithPassphrase, seal } from "@/lib/secrets";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));
const admin: Actor = { id: "admin", role: "admin", label: "admin@example.com" };
const author: Actor = { id: "author", role: "author", label: "a@example.com" };
const day = 86_400_000;

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.insert(schema.user).values([
    { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" },
    { id: "author", name: "A", email: "a@example.com", role: "author" },
  ]);
  await db.insert(schema.account).values({ id: "acc", accountId: "admin", providerId: "credential", userId: "admin", password: "scrypt$super-secret-hash" });
  await db.insert(schema.session).values([
    { id: "s-live", token: "live-token", userId: "admin", expiresAt: new Date(Date.now() + day), ipAddress: "203.0.113.45" },
    { id: "s-old", token: "old-token", userId: "admin", expiresAt: new Date(Date.now() - day) },
  ]);
  await db.insert(schema.setting).values({ key: "storage", value: { bucket: "media", accessKeyId: "AKIA", secretAccessKey: seal("s3-secret") } });
});
afterEach(() => setDbForTests(undefined));

describe("database admin", () => {
  it("lists every table, including the migrations ledger", async () => {
    const names = (await tableStats()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["user", "session", "post", "setting", "schema_migrations"]));
  });

  it("never shows passwords, tokens or sealed secrets", async () => {
    const all = JSON.stringify([await browseTable("account"), await browseTable("session"), await browseTable("setting")]);
    expect(all).not.toContain("super-secret-hash");
    expect(all).not.toContain("live-token");
    expect(all).not.toContain("203.0.113.45");
    expect(all).not.toMatch(/"iv":/);
    expect(all).toContain("media"); // non-secret settings stay readable
  });

  it("rejects tables that do not exist (no SQL injection through the table name)", async () => {
    await expect(browseTable('user"; drop table "user')).rejects.toThrow("Unknown table");
    expect((await tableStats()).some((t) => t.name === "user")).toBe(true);
  });

  it("purges only expired sessions and audits the run", async () => {
    expect(await runMaintenance(admin, "purge-sessions")).toBe("1 expired session(s) deleted.");
    expect((await db.select().from(schema.session)).map((s) => s.id)).toEqual(["s-live"]);
    expect((await db.select().from(schema.auditLog)).some((a) => a.action === "database.maintenance")).toBe(true);
    await expect(runMaintenance(admin, "drop-everything")).rejects.toThrow("Unknown");
  });

  it("stores millisecond rate-limit timestamps (Better Auth's database fallback)", async () => {
    await db.insert(schema.rateLimit).values({ id: "r1", key: "1.2.3.4/sign-in", count: 1, lastRequest: Date.now() - 2 * day });
    expect(await runMaintenance(admin, "purge-rate-limits")).toContain("1 rate-limit");
  });
});

describe("backups", () => {
  it("only admins configure backups, and a passphrase is required", async () => {
    await expect(saveGeneral(author, { schedule: "daily", hourUtc: "3", retention: "7", passphrase: "long-enough-phrase" })).rejects.toThrow();
    await expect(saveGeneral(admin, { schedule: "daily", hourUtc: "3", retention: "7", passphrase: "" })).rejects.toThrow("passphrase");
    await expect(saveGeneral(admin, { schedule: "daily", hourUtc: "3", retention: "7", passphrase: "short" })).rejects.toThrow("12 characters");
  });

  it("produces an encrypted archive without password hashes, sessions or credentials", async () => {
    await saveGeneral(admin, { schedule: "off", hourUtc: "3", retention: "7", passphrase: "correct horse battery staple" });
    const { filename, data } = await buildBackup();
    expect(filename).toMatch(/^jithendar-backup-\d{8}-\d{6}\.json\.gz\.enc$/);
    expect(data.toString("utf8")).not.toContain("admin@example.com");
    await expect(decryptWithPassphrase(data, "wrong passphrase!!")).rejects.toThrow();
    const payload = JSON.parse(gunzipSync(await decryptWithPassphrase(data, "correct horse battery staple")).toString("utf8"));
    expect(payload.format).toBe("jithendar-backup");
    expect(payload.tables.user.map((u: { email: string }) => u.email)).toContain("admin@example.com");
    const text = JSON.stringify(payload);
    for (const secret of ["super-secret-hash", "live-token", "s3-secret", "AKIA"]) expect(text).not.toContain(secret);
    expect(payload.tables.account).toBeUndefined();
    expect(payload.tables.session).toBeUndefined();
  });
});
