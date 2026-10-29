import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rowsOf } from "@/db/rows";
import { log } from "./log";

/**
 * A small Postgres-backed job queue (no extra service): jobs survive restarts, run once across
 * replicas (FOR UPDATE SKIP LOCKED), retry with exponential backoff and are de-duplicated while
 * pending (unique dedupe_key among queued/running jobs).
 */
export class PermanentJobError extends Error {}

export type JobRow = { id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number };
export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export async function enqueue(kind: string, payload: Record<string, unknown>, opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {}): Promise<boolean> {
  const db = await getDb();
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`
      insert into job (kind, dedupe_key, payload, run_at, max_attempts)
      values (${kind}, ${opts.dedupeKey ?? null}, ${JSON.stringify(payload)}::jsonb, ${(opts.runAt ?? new Date()).toISOString()}, ${opts.maxAttempts ?? 5})
      on conflict do nothing
      returning id`),
  );
  return rows.length > 0;
}

/** 1 min, 2 min, 4 min … capped at 1 hour. */
export const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);

export async function runDueJobs(handlers: Record<string, JobHandler>, now = new Date(), limit = 10) {
  const db = await getDb();
  const at = now.toISOString();
  // A worker that died mid-job leaves it "running"; hand it back after its lock expires.
  await db.execute(sql`update job set status = 'queued' where status = 'running' and locked_until < ${at}`);
  const jobs = rowsOf<JobRow>(
    await db.execute(sql`
      update job set status = 'running', attempts = attempts + 1, locked_until = ${new Date(now.getTime() + 5 * 60_000).toISOString()}
      where id in (select id from job where status = 'queued' and run_at <= ${at} order by run_at limit ${limit} for update skip locked)
      returning id, kind, payload, attempts, max_attempts`),
  );
  const result = { done: 0, retried: 0, failed: 0 };
  for (const job of jobs) {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new PermanentJobError(`no handler for ${job.kind}`);
      await handler(typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload);
      await db.execute(sql`update job set status = 'done', finished_at = ${new Date().toISOString()}, last_error = null where id = ${job.id}`);
      result.done++;
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      if (error instanceof PermanentJobError || job.attempts >= job.max_attempts) {
        await db.execute(sql`update job set status = 'failed', finished_at = ${new Date().toISOString()}, last_error = ${message} where id = ${job.id}`);
        log.error("job failed", { jobId: job.id, kind: job.kind, attempts: job.attempts, error: message });
        result.failed++;
      } else {
        const retryAt = new Date(now.getTime() + backoffMs(job.attempts)).toISOString();
        await db.execute(sql`update job set status = 'queued', run_at = ${retryAt}, last_error = ${message} where id = ${job.id}`);
        log.warn("job will retry", { jobId: job.id, kind: job.kind, attempts: job.attempts, error: message });
        result.retried++;
      }
    }
  }
  return result;
}

/** For Admin → System status. */
export async function jobSummary() {
  const db = await getDb();
  const rows = rowsOf<{ status: string; n: number }>(await db.execute(sql`select status, count(*)::int as n from job where created_at > now() - interval '7 days' group by status`));
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}
