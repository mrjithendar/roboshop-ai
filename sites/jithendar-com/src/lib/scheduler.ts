import { indexNowHandler } from "./indexnow";
import { runDueJobs } from "./jobs";
import { log } from "./log";
import { publishDuePosts } from "./posts";

/**
 * Background worker in every replica (started from instrumentation.ts): every 30 s it publishes
 * scheduled posts whose time has come and runs due jobs (IndexNow). Restart-safe (state lives in
 * Postgres) and safe with several replicas (conditional updates, SKIP LOCKED). Missed ticks during
 * downtime are caught up on the next tick, so a post scheduled while the site was down goes live
 * as soon as it is back.
 */
export async function workerTick(now = new Date()) {
  const published = await publishDuePosts(now);
  if (published.length) log.info("scheduled posts published", { count: published.length, ids: published });
  const jobs = await runDueJobs({ indexnow: indexNowHandler }, now);
  if (jobs.done || jobs.retried || jobs.failed) log.info("jobs processed", jobs);
}

export function startWorker() {
  const g = globalThis as unknown as { __workerTimer?: NodeJS.Timeout };
  if (g.__workerTimer) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await workerTick();
    } catch (error) {
      log.warn("worker tick failed", { err: error });
    } finally {
      running = false;
    }
  };
  g.__workerTimer = setInterval(() => void tick(), 30_000);
  g.__workerTimer.unref?.();
  void tick();
}
