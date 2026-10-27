import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import type { Role } from "./auth";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { getRedis } from "./redis";

export const SCOPES = ["posts:read", "posts:write"] as const;
export type Scope = (typeof SCOPES)[number];
const RATE_PER_MINUTE = 120;

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

const createInput = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1, "Choose at least one scope"),
  expiresInDays: z.coerce.number().int().min(0).max(3650).default(0),
});

/** Returns the full key exactly once; only its SHA-256 hash is stored. */
export async function createApiKey(actor: Actor, raw: unknown): Promise<{ key: string; id: string }> {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) throw new PostError("The key settings are not valid.", 400, parsed.error.issues.map((i) => i.message));
  const key = `jk_${randomBytes(32).toString("base64url")}`;
  const db = await getDb();
  const [row] = await db
    .insert(schema.apiKey)
    .values({
      name: parsed.data.name,
      prefix: key.slice(0, 11),
      hash: hash(key),
      scopes: parsed.data.scopes,
      userId: actor.id,
      expiresAt: parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000) : null,
    })
    .returning({ id: schema.apiKey.id });
  await audit(actor, "apikey.create", row!.id, { name: parsed.data.name, scopes: parsed.data.scopes });
  return { key, id: row!.id };
}

export async function listApiKeys(actor: Actor) {
  const db = await getDb();
  const rows = await db
    .select({ key: schema.apiKey, owner: schema.user.email })
    .from(schema.apiKey)
    .innerJoin(schema.user, eq(schema.user.id, schema.apiKey.userId))
    .where(actor.role === "admin" ? undefined : eq(schema.apiKey.userId, actor.id))
    .orderBy(desc(schema.apiKey.createdAt));
  const now = Date.now();
  return rows.map((r) => ({ ...r, state: r.key.revokedAt ? "revoked" : r.key.expiresAt && r.key.expiresAt.getTime() < now ? "expired" : "active" }) as const);
}

export async function revokeApiKey(actor: Actor, id: string) {
  const db = await getDb();
  const where = actor.role === "admin" ? eq(schema.apiKey.id, id) : and(eq(schema.apiKey.id, id), eq(schema.apiKey.userId, actor.id));
  const out = await db.update(schema.apiKey).set({ revokedAt: new Date() }).where(where).returning({ id: schema.apiKey.id });
  if (out.length === 0) throw new PostError("Key not found.", 404);
  await audit(actor, "apikey.revoke", id);
}

const memoryBuckets = new Map<string, { minute: number; n: number }>();

async function withinRateLimit(keyId: string): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const redis = await getRedis();
  if (redis) {
    const k = `apikey:${keyId}:${minute}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, 70);
    return n <= RATE_PER_MINUTE;
  }
  const b = memoryBuckets.get(keyId);
  if (!b || b.minute !== minute) {
    memoryBuckets.set(keyId, { minute, n: 1 });
    return true;
  }
  b.n += 1;
  return b.n <= RATE_PER_MINUTE;
}

export type ApiAuth = { actor: Actor; scopes: Scope[] };

/** Resolve `Authorization: Bearer jk_…` to the key owner's identity and the key's scopes. */
export async function authenticateApiKey(header: string | null): Promise<ApiAuth> {
  const key = header?.match(/^Bearer\s+(jk_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!key) throw new PostError("Missing or malformed API key. Use: Authorization: Bearer jk_…", 403);
  const db = await getDb();
  const [row] = await db
    .select({ key: schema.apiKey, role: schema.user.role, banned: schema.user.banned })
    .from(schema.apiKey)
    .innerJoin(schema.user, eq(schema.user.id, schema.apiKey.userId))
    .where(eq(schema.apiKey.hash, hash(key)));
  if (!row || row.key.revokedAt || (row.key.expiresAt && row.key.expiresAt.getTime() < Date.now()) || row.banned) {
    throw new PostError("Invalid, expired or revoked API key.", 403);
  }
  if (!(await withinRateLimit(row.key.id))) throw new PostError("Rate limit exceeded (120 requests per minute per key).", 400);
  await db.update(schema.apiKey).set({ lastUsedAt: new Date() }).where(eq(schema.apiKey.id, row.key.id));
  return {
    actor: { id: row.key.userId, role: row.role as Role, label: `api:${row.key.prefix}` },
    scopes: row.key.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)),
  };
}
