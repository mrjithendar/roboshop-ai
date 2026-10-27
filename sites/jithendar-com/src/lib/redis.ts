import type { Redis } from "ioredis";
import { log } from "./log";

/**
 * Optional Redis (REDIS_URL). Used for cross-replica cache invalidation, Better Auth sessions and
 * rate limits. Everything works without it: callers fall back to Postgres and per-process caches.
 */
const g = globalThis as unknown as { __redis?: Promise<Redis | null>; __redisSub?: Promise<Redis | null> };

async function connect(): Promise<Redis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const { Redis } = await import("ioredis");
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false, connectTimeout: 3000 });
  client.on("error", (err) => log.warn("redis error", { err }));
  try {
    await client.connect();
    return client;
  } catch (error) {
    log.warn("redis unavailable, continuing without it", { err: error });
    return null;
  }
}

export function getRedis(): Promise<Redis | null> {
  g.__redis ??= connect();
  return g.__redis;
}

/** A second connection for SUBSCRIBE (a subscribing connection cannot run other commands). */
export function getRedisSubscriber(): Promise<Redis | null> {
  g.__redisSub ??= connect();
  return g.__redisSub;
}
