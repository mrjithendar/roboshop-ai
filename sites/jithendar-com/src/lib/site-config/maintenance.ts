import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type Maintenance = { enabled: boolean; message: string; retryAfterMinutes: number };
const OFF: Maintenance = { enabled: false, message: "", retryAfterMinutes: 30 };
const TTL_MS = 10_000;
let cached: { value: Maintenance; at: number } | undefined;

/**
 * The published maintenance switch, read with one small query and cached for 10 s per process (the proxy
 * runs before the app and keeps its own cache, so changes apply on every replica within 10 seconds).
 */
export async function maintenanceState(now = Date.now()): Promise<Maintenance> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  let value = OFF;
  try {
    const db = await getDb();
    const [row] = await db.select({ config: schema.siteConfig.config }).from(schema.siteConfig).where(eq(schema.siteConfig.key, "published"));
    const m = (row?.config as { general?: { maintenance?: Partial<Maintenance> } } | undefined)?.general?.maintenance;
    if (m && m.enabled === true) {
      value = {
        enabled: true,
        message: typeof m.message === "string" ? m.message.slice(0, 300) : "",
        retryAfterMinutes: Number.isInteger(m.retryAfterMinutes) ? Math.min(1440, Math.max(5, m.retryAfterMinutes!)) : 30,
      };
    }
  } catch {
    value = cached?.value ?? OFF; // database unavailable: keep the last known state
  }
  cached = { value, at: now };
  return value;
}

export function resetMaintenanceCache() {
  cached = undefined;
}

/** Paths that stay available during maintenance: sign-in, admin, account, APIs, assets, health and crawl files. */
export const MAINTENANCE_EXEMPT = /^\/(admin|account|login|setup|api|_next|media|images|preview|icon|apple-icon|favicon\.ico|robots\.txt|ads\.txt)(\/|$|\.)/;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A self-contained 503 page (no app rendering, no scripts). */
export function maintenancePage(siteName: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Down for maintenance · ${escapeHtml(siteName)}</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#17191d;padding:24px}@media(prefers-color-scheme:dark){body{background:#0e1013;color:#f2f3f5}}main{max-width:32rem;text-align:center}h1{font-size:1.75rem;line-height:1.2;margin:0 0 .75rem}p{margin:0;opacity:.8}</style></head><body><main><h1>${escapeHtml(siteName)} is down for maintenance</h1><p>${escapeHtml(message || "We will be back shortly.")}</p></main></body></html>`;
}
