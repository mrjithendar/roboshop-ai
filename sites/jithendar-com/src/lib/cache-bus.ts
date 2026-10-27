import { getRedis, getRedisSubscriber } from "./redis";

/** Per-process caches register here; invalidation clears locally and tells the other replicas via Redis. */
type Kind = "content" | "categories" | "settings";
const CHANNEL = "jithendar:invalidate";
const handlers = new Map<Kind, Set<() => void>>();
const origin = crypto.randomUUID();

export function onInvalidate(kind: Kind, clear: () => void) {
  const set = handlers.get(kind) ?? new Set();
  set.add(clear);
  handlers.set(kind, set);
}

function clearLocal(kind: Kind) {
  for (const clear of handlers.get(kind) ?? []) clear();
}

export function broadcastInvalidate(kind: Kind) {
  clearLocal(kind);
  void getRedis()
    .then((r) => r?.publish(CHANNEL, JSON.stringify({ kind, origin })))
    .catch(() => {});
}

/** Called once at server start (instrumentation.ts). */
export async function listenForInvalidations() {
  const sub = await getRedisSubscriber();
  if (!sub) return;
  await sub.subscribe(CHANNEL);
  sub.on("message", (_channel, message) => {
    try {
      const { kind, origin: from } = JSON.parse(message) as { kind: Kind; origin: string };
      if (from !== origin) clearLocal(kind);
    } catch {
      // ignore malformed messages
    }
  });
}
