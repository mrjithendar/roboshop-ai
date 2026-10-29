import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rowsOf } from "@/db/rows";
import { audit } from "./audit";
import { PostError, type Actor } from "./posts";

export type TableStat = { name: string; rows: number; size: string; bytes: number; lastVacuum: string | null; lastAnalyze: string | null };

/** Public tables with estimated row counts, total size and maintenance times. */
export async function tableStats(): Promise<TableStat[]> {
  const db = await getDb();
  return rowsOf<TableStat>(
    await db.execute(sql`
      select c.relname as name,
             greatest(coalesce(s.n_live_tup, 0), 0)::int as rows,
             pg_size_pretty(pg_total_relation_size(c.oid)) as size,
             pg_total_relation_size(c.oid)::bigint as bytes,
             greatest(s.last_vacuum, s.last_autovacuum)::text as "lastVacuum",
             greatest(s.last_analyze, s.last_autoanalyze)::text as "lastAnalyze"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      left join pg_stat_user_tables s on s.relid = c.oid
      where c.relkind = 'r'
      order by c.relname`),
  ).map((t) => ({ ...t, bytes: Number(t.bytes) }));
}

/** Connection details with the password removed, plus a live round trip. */
export async function connectionInfo() {
  const db = await getDb();
  const started = performance.now();
  const [r] = rowsOf<{ version: string; db: string; usr: string; tz: string; max: string; conns: number; uptime: string; ssl: boolean | null }>(
    await db.execute(sql`
      select version() as version, current_database() as db, current_user as usr, current_setting('TimeZone') as tz,
             current_setting('max_connections') as max,
             (select count(*)::int from pg_stat_activity where datname = current_database()) as conns,
             date_trunc('second', now() - pg_postmaster_start_time())::text as uptime,
             (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl`),
  );
  const ms = Math.round(performance.now() - started);
  let target = "embedded PGlite (local development)";
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    target = `${u.protocol}//${u.username ? `${u.username}:••••@` : ""}${u.host}${u.pathname}`;
  }
  return {
    target,
    latencyMs: ms,
    details: {
      Server: r?.version.split(" on ")[0] ?? "unknown",
      Database: r?.db ?? "",
      User: r?.usr ?? "",
      Connections: `${r?.conns ?? "?"} of ${r?.max ?? "?"}`,
      Uptime: r?.uptime ?? "",
      TLS: r?.ssl ? "yes" : "no (in-cluster)",
      "Time zone": r?.tz ?? "",
    },
  };
}

const SENSITIVE = /password|secret|token|passphrase|private|credential|^hash$|^value$|access_?key/i;

function redact(value: unknown, column = ""): unknown {
  if (value === null || value === undefined) return value;
  if (SENSITIVE.test(column) && column !== "value") return "•••• redacted";
  if (column === "ip_address" && typeof value === "string") return value.replace(/[\d a-f]+$/i, "xxx");
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) && k !== "value" ? "•••• redacted" : redact(v)]));
  }
  return value;
}

/** Columns that hold secrets outright (auth tokens, OTPs, key hashes) are never shown, even to admins. */
const HIDDEN: Record<string, string[]> = { verification: ["value"], rate_limit: ["key"] };

export type BrowseResult = { table: string; columns: string[]; rows: Record<string, unknown>[]; total: number; page: number; pageSize: number };

/** Read-only page of a table. Secret columns and secret JSON fields are redacted. */
export async function browseTable(table: string, page = 1, pageSize = 25): Promise<BrowseResult> {
  const known = (await tableStats()).map((t) => t.name);
  if (!known.includes(table)) throw new PostError("Unknown table.");
  const db = await getDb();
  const cols = rowsOf<{ column_name: string }>(
    await db.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`),
  ).map((c) => c.column_name);
  const order = cols.includes("created_at") ? sql`order by ${sql.identifier("created_at")} desc` : sql``;
  const p = Math.max(1, Math.floor(page) || 1);
  const [{ n } = { n: 0 }] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`));
  const rows = rowsOf<Record<string, unknown>>(
    await db.execute(sql`select * from ${sql.identifier(table)} ${order} limit ${pageSize} offset ${(p - 1) * pageSize}`),
  ).map((row) =>
    Object.fromEntries(cols.map((c) => [c, HIDDEN[table]?.includes(c) ? "•••• redacted" : redact(row[c], c)])),
  );
  return { table, columns: cols, rows, total: n, page: p, pageSize };
}

export const MAINTENANCE = {
  "purge-sessions": "Delete expired sessions",
  "purge-verifications": "Delete expired verification codes",
  "purge-previews": "Delete expired previews",
  "purge-rate-limits": "Delete rate-limit entries older than a day",
  vacuum: "VACUUM ANALYZE (reclaim space, refresh planner statistics)",
} as const;

export type MaintenanceTask = keyof typeof MAINTENANCE;

/** Run one maintenance task; every run is audited. */
export async function runMaintenance(actor: Actor, task: string): Promise<string> {
  if (!(task in MAINTENANCE)) throw new PostError("Unknown maintenance task.");
  const db = await getDb();
  const deleted = async (q: ReturnType<typeof sql>) => rowsOf<unknown>(await db.execute(q)).length;
  let message: string;
  switch (task as MaintenanceTask) {
    case "purge-sessions":
      message = `${await deleted(sql`delete from "session" where expires_at < now() returning id`)} expired session(s) deleted.`;
      break;
    case "purge-verifications":
      message = `${await deleted(sql`delete from verification where expires_at < now() returning id`)} expired verification code(s) deleted.`;
      break;
    case "purge-previews":
      message = `${await deleted(sql`delete from preview where expires_at < now() returning token`)} expired preview(s) deleted.`;
      break;
    case "purge-rate-limits":
      message = `${await deleted(sql`delete from rate_limit where last_request < ${Date.now() - 86_400_000} returning id`)} rate-limit entr(ies) deleted.`;
      break;
    case "vacuum":
      await db.execute(sql`vacuum (analyze)`);
      message = "VACUUM ANALYZE finished.";
      break;
  }
  await audit(actor, "database.maintenance", task, { result: message });
  return message;
}
