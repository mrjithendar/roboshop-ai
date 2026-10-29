import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rowsOf } from "@/db/rows";
import { getRedis } from "./redis";

/**
 * Fixed-window counter for app actions (profile edits, avatar uploads). Shared by all replicas: Redis when
 * configured, otherwise the `rate_limit` table Better Auth already uses (keys prefixed `app:`).
 * Returns true when the call is allowed.
 */
export async function hit(key: string, max: number, windowSeconds: number, now = Date.now()): Promise<boolean> {
  const id = `app:${key}`;
  const redis = await getRedis();
  if (redis) {
    const count = Number(await redis.eval("local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return c", 1, id, String(windowSeconds)));
    return count <= max;
  }
  const db = await getDb();
  const windowStart = now - windowSeconds * 1000;
  // last_request holds the window start for app keys.
  const [row] = rowsOf<{ count: number }>(
    await db.execute(sql`
      insert into rate_limit (id, key, count, last_request) values (${id}, ${id}, 1, ${now})
      on conflict (key) do update set
        count = case when rate_limit.last_request < ${windowStart} then 1 else rate_limit.count + 1 end,
        last_request = case when rate_limit.last_request < ${windowStart} then ${now} else rate_limit.last_request end
      returning count`),
  );
  return (row?.count ?? 1) <= max;
}
