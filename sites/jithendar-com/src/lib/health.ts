import { connect as tlsConnect } from "node:tls";
import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { rowsOf } from "@/db/rows";
import { emailSummary } from "./mail";
import { getRedis } from "./redis";
import { geminiImageConfig } from "./gemini";
import { generationUsage } from "./image-generation";
import { checkStorage } from "./storage";
import { turnstileSecret, turnstileSiteKey } from "./turnstile";

export type Check = { name: string; status: "ok" | "degraded" | "down" | "not configured"; ms: number | null; detail: string };

const TIMEOUT = 5000;

async function timed(name: string, fn: () => Promise<Omit<Check, "name" | "ms">>): Promise<Check> {
  const started = performance.now();
  try {
    const r = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${TIMEOUT / 1000}s`)), TIMEOUT))]);
    return { name, ms: r.status === "not configured" ? null : Math.round(performance.now() - started), ...r };
  } catch (error) {
    return { name, status: "down", ms: Math.round(performance.now() - started), detail: (error as Error).message.slice(0, 200) };
  }
}

async function reachable(url: string): Promise<Omit<Check, "name" | "ms">> {
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(TIMEOUT), redirect: "manual" });
  return { status: res.status < 500 ? "ok" : "degraded", detail: `HTTP ${res.status}` };
}

function certificateDays(host: string): Promise<Omit<Check, "name" | "ms">> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port: 443, servername: host, timeout: TIMEOUT }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
      resolve({ status: days > 14 ? "ok" : days > 0 ? "degraded" : "down", detail: `expires ${cert.valid_to} (${days} days)` });
    });
    socket.on("error", reject);
    socket.on("timeout", () => socket.destroy(new Error("TLS timeout")));
  });
}

/** Live status of everything the site depends on (admin only; makes real outbound requests). */
export async function systemChecks(): Promise<{ app: Record<string, string>; checks: Check[] }> {
  const mem = process.memoryUsage();
  const app = {
    Version: process.env.GIT_SHA?.slice(0, 12) ?? "dev",
    "Node.js": process.version,
    Uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
    Memory: `${Math.round(mem.rss / 1024 / 1024)} MB RSS · ${Math.round(mem.heapUsed / 1024 / 1024)} MB heap`,
    Environment: process.env.APP_ENV ?? "development",
  };

  const checks = await Promise.all([
    timed("PostgreSQL", async () => {
      const db = await getDb();
      const [r] = rowsOf<{ version: string; size: string; conns: number }>(
        await db.execute(sql`select split_part(version(), ' ', 2) as version, pg_size_pretty(pg_database_size(current_database())) as size, (select count(*)::int from pg_stat_activity where datname = current_database()) as conns`),
      );
      const [m] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from schema_migrations`));
      return { status: "ok", detail: `v${r?.version} · ${r?.size} · ${r?.conns} connections · ${m?.n} migrations` };
    }),
    timed("Redis", async () => {
      if (!process.env.REDIS_URL) return { status: "not configured", detail: "REDIS_URL not set; using Postgres and per-pod caches" };
      const redis = await getRedis();
      if (!redis) return { status: "down", detail: "configured but unreachable; falling back to Postgres" };
      await redis.ping();
      const used = (await redis.info("memory")).match(/used_memory_human:(\S+)/)?.[1];
      return { status: "ok", detail: `PONG · ${used ?? "?"} used` };
    }),
    timed("Media storage (Cloudflare R2)", checkStorage),
    timed("Image generation (Gemini)", async () => {
      const c = geminiImageConfig();
      if (!c) return { status: "not configured", detail: "set GEMINI_API_KEY and GEMINI_IMAGE_MODEL to enable “Generate image”" };
      const usage = await generationUsage();
      const total = Object.values(usage).reduce((a, b) => a + b, 0);
      const failed = (usage.failed ?? 0) + (usage.cancelled ?? 0);
      // No live call: every request to the model costs money. Failures in the last day show here instead.
      return { status: total > 2 && failed / total > 0.5 ? "degraded" : "ok", detail: `${c.model} · ${c.imageSize} · last 24 h: ${total} request(s), ${usage.accepted ?? 0} accepted, ${failed} failed/cancelled` };
    }),
    timed("Email (Amazon SES)", async () => {
      const e = await emailSummary();
      if (!e) return { status: process.env.SMTP_URL ? "ok" : "not configured", detail: process.env.SMTP_URL ? "SMTP fallback configured" : "verification and reset emails are skipped" };
      return { status: e.verifiedAt ? "ok" : "degraded", detail: `${e.from} · ${e.region}${e.verifiedAt ? "" : " (test email failed)"}` };
    }),
    timed("Cloudflare Turnstile", async () => {
      if (!turnstileSiteKey() || !turnstileSecret()) return { status: "down", detail: "keys missing: sign-in, comments and contact are blocked" };
      const r = await reachable("https://challenges.cloudflare.com/turnstile/v0/api.js");
      return { ...r, detail: `${process.env.TURNSTILE_SITE_KEY ? "production keys" : "test keys"} · ${r.detail}` };
    }),
    timed("Breached-password check", () => reachable("https://api.pwnedpasswords.com/range/21BD1")),
    timed("Trace collector", async () => {
      const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      if (!endpoint) return { status: "not configured", detail: "tracing off" };
      const r = await reachable(`${endpoint.replace(/\/$/, "")}/v1/traces`);
      return { status: "ok", detail: `${endpoint} · ${r.detail}` };
    }),
    timed("TLS certificate", () => certificateDays("jithendar.com")),
    timed("Backups", async () => {
      const db = await getDb();
      const [last] = await db.select().from(schema.backupRun).orderBy(desc(schema.backupRun.startedAt)).limit(1);
      if (!last) return { status: "not configured", detail: "no backup has run yet" };
      const ageH = Math.round((Date.now() - last.startedAt.getTime()) / 3_600_000);
      return { status: last.status === "success" ? (ageH < 8 * 24 ? "ok" : "degraded") : last.status === "partial" ? "degraded" : "down", detail: `last ${last.status}, ${ageH}h ago` };
    }),
  ]);
  return { app, checks };
}
