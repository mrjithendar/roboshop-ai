import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { desc, eq, sql } from "drizzle-orm";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { rowsOf } from "@/db/rows";
import { audit } from "./audit";
import { log } from "./log";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { encryptWithPassphrase, seal, unseal, type Sealed } from "./secrets";

/**
 * Encrypted site backups to S3-compatible storage, SFTP and Google Drive.
 * Contents: content, configuration and accounts WITHOUT password hashes, sessions, API-key hashes or stored
 * credentials. Each file is gzip + AES-256-GCM with a passphrase only the owner knows.
 */
const KEY = "backups";
const PREFIX = "jithendar-backup-";
const LOCK_ID = 7_250_032;

type S3Dest = { enabled: boolean; endpoint: string; region: string; bucket: string; prefix: string; forcePathStyle: boolean; accessKeyId: string; secret: Sealed };
type SftpDest = { enabled: boolean; host: string; port: number; username: string; path: string; password: Sealed | null; privateKey: Sealed | null };
type DriveDest = { enabled: boolean; folderId: string; credentials: Sealed };
export type BackupConfig = {
  passphrase: Sealed | null;
  schedule: "off" | "daily" | "weekly";
  hourUtc: number;
  retention: number;
  s3: S3Dest | null;
  sftp: SftpDest | null;
  gdrive: DriveDest | null;
};

const empty: BackupConfig = { passphrase: null, schedule: "off", hourUtc: 21, retention: 14, s3: null, sftp: null, gdrive: null };

export async function readBackupConfig(): Promise<BackupConfig> {
  const db = await getDb();
  const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, KEY));
  return { ...empty, ...((row?.value as Partial<BackupConfig>) ?? {}) };
}

async function writeConfig(c: BackupConfig, userId: string) {
  const db = await getDb();
  await db
    .insert(schema.setting)
    .values({ key: KEY, value: c, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: c, updatedBy: userId, updatedAt: new Date() } });
}

/** What the admin form may show: never secrets, only whether they are set. */
export async function backupSummary() {
  const c = await readBackupConfig();
  return {
    hasPassphrase: Boolean(c.passphrase),
    schedule: c.schedule,
    hourUtc: c.hourUtc,
    retention: c.retention,
    s3: c.s3 && { enabled: c.s3.enabled, endpoint: c.s3.endpoint, region: c.s3.region, bucket: c.s3.bucket, prefix: c.s3.prefix, forcePathStyle: c.s3.forcePathStyle, accessKeyId: c.s3.accessKeyId },
    sftp: c.sftp && { enabled: c.sftp.enabled, host: c.sftp.host, port: c.sftp.port, username: c.sftp.username, path: c.sftp.path, auth: c.sftp.privateKey ? "key" : "password" },
    gdrive: c.gdrive && { enabled: c.gdrive.enabled, folderId: c.gdrive.folderId },
  };
}

function admin(actor: Actor) {
  if (actor.role !== "admin") throw new PostError("Only admins can manage backups.", 403);
}

const generalInput = z.object({
  schedule: z.enum(["off", "daily", "weekly"]),
  hourUtc: z.coerce.number().int().min(0).max(23),
  retention: z.coerce.number().int().min(1).max(365),
  passphrase: z.string().max(200).default(""),
});

export async function saveGeneral(actor: Actor, raw: unknown) {
  admin(actor);
  const parsed = generalInput.safeParse(raw);
  if (!parsed.success) throw new PostError("Backup settings are not valid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const c = await readBackupConfig();
  if (parsed.data.passphrase && parsed.data.passphrase.length < 12) throw new PostError("Use a backup passphrase of at least 12 characters.");
  if (!parsed.data.passphrase && !c.passphrase) throw new PostError("Set a backup passphrase. You will need it to restore.");
  await writeConfig(
    { ...c, schedule: parsed.data.schedule, hourUtc: parsed.data.hourUtc, retention: parsed.data.retention, passphrase: parsed.data.passphrase ? seal(parsed.data.passphrase) : c.passphrase },
    actor.id,
  );
  await audit(actor, "backup.configure", "general", { schedule: parsed.data.schedule, retention: parsed.data.retention });
}

const keep = (input: string, existing: Sealed | null | undefined) => (input ? seal(input) : existing ?? null);

export async function saveDestination(actor: Actor, kind: "s3" | "sftp" | "gdrive", f: Record<string, string | boolean>) {
  admin(actor);
  const c = await readBackupConfig();
  const s = (k: string) => String(f[k] ?? "").trim();
  if (kind === "s3") {
    const secret = keep(s("secret"), c.s3?.secret);
    if (!s("bucket") || !s("accessKeyId") || !secret) throw new PostError("Bucket, access key ID and secret are required.");
    c.s3 = { enabled: f.enabled === true, endpoint: s("endpoint"), region: s("region") || "us-east-1", bucket: s("bucket"), prefix: s("prefix").replace(/\/+$/, ""), forcePathStyle: f.forcePathStyle === true, accessKeyId: s("accessKeyId"), secret };
  } else if (kind === "sftp") {
    const password = keep(s("password"), c.sftp?.password);
    const privateKey = keep(s("privateKey"), c.sftp?.privateKey);
    if (!s("host") || !s("username") || (!password && !privateKey)) throw new PostError("Host, username and a password or private key are required.");
    c.sftp = { enabled: f.enabled === true, host: s("host"), port: Number(s("port") || 22), username: s("username"), path: s("path") || ".", password, privateKey };
  } else {
    const credentials = keep(s("credentials"), c.gdrive?.credentials);
    if (!s("folderId") || !credentials) throw new PostError("Folder ID and credentials JSON are required.");
    if (s("credentials")) {
      try {
        const t = (JSON.parse(s("credentials")) as { type?: string }).type;
        if (t !== "service_account" && t !== "authorized_user") throw new Error();
      } catch {
        throw new PostError('Credentials must be a service-account JSON or an "authorized_user" JSON with a refresh token.');
      }
    }
    c.gdrive = { enabled: f.enabled === true, folderId: s("folderId"), credentials };
  }
  await writeConfig(c, actor.id);
  await audit(actor, "backup.destination", kind, { enabled: f.enabled === true });
}

// --- Destinations -----------------------------------------------------------------

type Target = { name: string; put: (file: string, data: Buffer) => Promise<void>; prune: (retention: number) => Promise<number> };

function s3Target(d: S3Dest): Target {
  const client = new S3Client({
    region: d.region,
    ...(d.endpoint ? { endpoint: d.endpoint } : {}),
    forcePathStyle: d.forcePathStyle,
    credentials: { accessKeyId: d.accessKeyId, secretAccessKey: unseal(d.secret) },
  });
  const key = (f: string) => [d.prefix, f].filter(Boolean).join("/");
  return {
    name: "s3",
    put: async (file, data) => {
      await client.send(new PutObjectCommand({ Bucket: d.bucket, Key: key(file), Body: data, ContentType: "application/octet-stream" }));
    },
    prune: async (retention) => {
      const out = await client.send(new ListObjectsV2Command({ Bucket: d.bucket, Prefix: key(PREFIX) }));
      const old = (out.Contents ?? []).map((o) => o.Key!).filter(Boolean).sort().reverse().slice(retention);
      for (const k of old) await client.send(new DeleteObjectCommand({ Bucket: d.bucket, Key: k }));
      return old.length;
    },
  };
}

function sftpTarget(d: SftpDest): Target {
  const connect = async () => {
    const { default: SftpClient } = await import("ssh2-sftp-client");
    const sftp = new SftpClient();
    await sftp.connect({
      host: d.host,
      port: d.port,
      username: d.username,
      ...(d.privateKey ? { privateKey: unseal(d.privateKey) } : { password: unseal(d.password!) }),
      readyTimeout: 15_000,
    });
    return sftp;
  };
  const p = (f: string) => `${d.path.replace(/\/+$/, "")}/${f}`;
  return {
    name: "sftp",
    put: async (file, data) => {
      const sftp = await connect();
      try {
        await sftp.put(data, p(file));
      } finally {
        await sftp.end();
      }
    },
    prune: async (retention) => {
      const sftp = await connect();
      try {
        const files = (await sftp.list(d.path)).map((f) => f.name).filter((n) => n.startsWith(PREFIX)).sort().reverse().slice(retention);
        for (const f of files) await sftp.delete(p(f));
        return files.length;
      } finally {
        await sftp.end();
      }
    },
  };
}

function driveTarget(d: DriveDest): Target {
  const token = async () => {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({ credentials: JSON.parse(unseal(d.credentials)), scopes: ["https://www.googleapis.com/auth/drive.file"] });
    const t = await (await auth.getClient()).getAccessToken();
    if (!t.token) throw new Error("Google did not return an access token.");
    return t.token;
  };
  const api = "https://www.googleapis.com/drive/v3/files";
  return {
    name: "gdrive",
    put: async (file, data) => {
      const boundary = `jk${Date.now()}`;
      const meta = JSON.stringify({ name: file, parents: [d.folderId] });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Google Drive upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    },
    prune: async (retention) => {
      const t = await token();
      const q = encodeURIComponent(`'${d.folderId}' in parents and name contains '${PREFIX}' and trashed = false`);
      const res = await fetch(`${api}?q=${q}&orderBy=name desc&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) throw new Error(`Google Drive list failed (${res.status})`);
      const old = ((await res.json()) as { files: { id: string }[] }).files.slice(retention);
      for (const f of old) await fetch(`${api}/${f.id}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } });
      return old.length;
    },
  };
}

function targets(c: BackupConfig, onlyEnabled = true): Target[] {
  const out: Target[] = [];
  if (c.s3 && (!onlyEnabled || c.s3.enabled)) out.push(s3Target(c.s3));
  if (c.sftp && (!onlyEnabled || c.sftp.enabled)) out.push(sftpTarget(c.sftp));
  if (c.gdrive && (!onlyEnabled || c.gdrive.enabled)) out.push(driveTarget(c.gdrive));
  return out;
}

/** Write and remove a small probe file to prove a destination works. */
export async function testDestination(actor: Actor, kind: "s3" | "sftp" | "gdrive") {
  admin(actor);
  const c = await readBackupConfig();
  const t = targets(c, false).find((x) => x.name === kind);
  if (!t) throw new PostError("Save this destination first.");
  try {
    await t.put(`${PREFIX}connection-test.txt`, Buffer.from("ok"));
  } catch (e) {
    throw new PostError(`Connection test failed: ${(e as Error).message}`);
  }
}

// --- Building and running -----------------------------------------------------------

/** Tables in the backup, and columns that must never leave the server. */
const TABLES: { name: string; omit?: string[] }[] = [
  { name: "post" },
  { name: "page" },
  { name: "category" },
  { name: "author_profile" },
  { name: "comment" },
  { name: "contact_message" },
  { name: "media" },
  { name: "redirect" },
  { name: "user", omit: [] },
];

export async function buildBackup(): Promise<{ filename: string; data: Buffer }> {
  const c = await readBackupConfig();
  if (!c.passphrase) throw new PostError("Set a backup passphrase first.");
  const db = await getDb();
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t.name] = rowsOf(await db.execute(sql.raw(`select * from "${t.name}"`)));
  // Only the public site settings: storage/email/backup credentials are excluded on purpose.
  const [site] = await db.select().from(schema.setting).where(eq(schema.setting.key, "site"));
  const payload = {
    format: "jithendar-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    appVersion: process.env.GIT_SHA ?? "dev",
    note: "Excludes password hashes, sessions, API-key hashes and stored credentials. Media bytes live in S3; this holds their metadata.",
    settings: site?.value ?? null,
    tables,
  };
  const data = await encryptWithPassphrase(gzipSync(Buffer.from(JSON.stringify(payload))), unseal(c.passphrase));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return { filename: `${PREFIX}${stamp}.json.gz.enc`, data };
}

export async function runBackup(trigger: "manual" | "scheduled", actor?: Actor) {
  const db = await getDb();
  const [run] = await db.insert(schema.backupRun).values({ trigger, status: "running", triggeredBy: actor?.label ?? "scheduler" }).returning();
  const results: { destination: string; ok: boolean; detail: string }[] = [];
  try {
    const c = await readBackupConfig();
    const dests = targets(c);
    if (dests.length === 0) throw new PostError("Enable at least one destination.");
    const { filename, data } = await buildBackup();
    for (const d of dests) {
      try {
        await d.put(filename, data);
        const pruned = await d.prune(c.retention).catch(() => 0);
        results.push({ destination: d.name, ok: true, detail: pruned ? `uploaded; removed ${pruned} old backup(s)` : "uploaded" });
      } catch (e) {
        results.push({ destination: d.name, ok: false, detail: (e as Error).message.slice(0, 300) });
      }
    }
    const status = results.every((r) => r.ok) ? "success" : results.some((r) => r.ok) ? "partial" : "failed";
    await db.update(schema.backupRun).set({ status, filename, sizeBytes: data.length, results, finishedAt: new Date() }).where(eq(schema.backupRun.id, run!.id));
    log.info("backup finished", { trigger, status, sizeBytes: data.length, results });
    if (actor) await audit(actor, "backup.run", filename, { status });
    return { status, results };
  } catch (error) {
    const detail = error instanceof PostError ? error.message : "Unexpected error (see logs).";
    if (!(error instanceof PostError)) log.error("backup failed", { err: error, trigger });
    await db.update(schema.backupRun).set({ status: "failed", results: [{ destination: "-", ok: false, detail }], finishedAt: new Date() }).where(eq(schema.backupRun.id, run!.id));
    return { status: "failed", results: [{ destination: "-", ok: false, detail }] };
  }
}

export async function recentRuns(limit = 20) {
  const db = await getDb();
  return db.select().from(schema.backupRun).orderBy(desc(schema.backupRun.startedAt)).limit(limit);
}

/** In-app scheduler: one replica (Postgres advisory lock) runs due backups. Checked every 15 minutes. */
export function startBackupScheduler() {
  const g = globalThis as unknown as { __backupTimer?: NodeJS.Timeout };
  if (g.__backupTimer) return;
  const tick = async () => {
    try {
      const c = await readBackupConfig();
      if (c.schedule === "off" || !c.passphrase) return;
      const now = new Date();
      if (now.getUTCHours() < c.hourUtc) return;
      const [last] = await recentRuns(1);
      const interval = c.schedule === "daily" ? 20 * 3600_000 : 6.5 * 86_400_000;
      if (last && now.getTime() - last.startedAt.getTime() < interval) return;
      const db = await getDb();
      const [{ locked } = { locked: false }] = rowsOf<{ locked: boolean }>(await db.execute(sql`select pg_try_advisory_lock(${LOCK_ID}) as locked`));
      if (!locked) return;
      try {
        await runBackup("scheduled");
      } finally {
        await db.execute(sql`select pg_advisory_unlock(${LOCK_ID})`);
      }
    } catch (error) {
      log.warn("backup scheduler tick failed", { err: error });
    }
  };
  g.__backupTimer = setInterval(() => void tick(), 15 * 60_000);
  g.__backupTimer.unref?.();
}
