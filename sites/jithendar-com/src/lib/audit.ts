import { getDb, schema } from "@/db";

/** Append-only record of admin/API actions. Never store secrets in `detail`. */
export async function audit(actor: { id?: string | null; label: string }, action: string, target?: string, detail?: Record<string, unknown>) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ actorId: actor.id ?? null, actor: actor.label, action, target: target ?? null, detail: detail ?? null });
}
