import { and, desc, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import type { Actor } from "./posts";
import { PostError } from "./posts";

/**
 * Revisions (committed history) and autosaves (one uncommitted working copy per user and document).
 * Restoring a revision loads it into the editor; saving then creates a new revision, so history is
 * never rewritten or deleted.
 */
export type Entity = "post" | "page";

export async function recordRevision(db: Db, entity: Entity, entityId: string, version: number, reason: string, payload: object, authorId: string | null) {
  await db.insert(schema.revision).values({ entity, entityId, version, reason, payload: JSON.parse(JSON.stringify(payload)), authorId });
}

export async function listRevisions(entity: Entity, entityId: string, limit = 50) {
  const db = await getDb();
  return db
    .select({ id: schema.revision.id, version: schema.revision.version, reason: schema.revision.reason, createdAt: schema.revision.createdAt, author: schema.user.name })
    .from(schema.revision)
    .leftJoin(schema.user, eq(schema.user.id, schema.revision.authorId))
    .where(and(eq(schema.revision.entity, entity), eq(schema.revision.entityId, entityId)))
    .orderBy(desc(schema.revision.createdAt))
    .limit(limit);
}

export async function getRevision(entity: Entity, entityId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new PostError("Revision not found.", 404);
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.revision)
    .where(and(eq(schema.revision.id, id), eq(schema.revision.entity, entity), eq(schema.revision.entityId, entityId)));
  if (!row) throw new PostError("Revision not found.", 404);
  return row;
}

const MAX_AUTOSAVE_BYTES = 400_000;

export async function saveAutosave(actor: Actor, entity: Entity, entityId: string, baseVersion: number, payload: object) {
  const json = JSON.stringify(payload);
  if (json.length > MAX_AUTOSAVE_BYTES) throw new PostError("The document is too large to autosave.", 413);
  const db = await getDb();
  const values = { entity, entityId, userId: actor.id, baseVersion, payload: JSON.parse(json), savedAt: new Date() };
  await db
    .insert(schema.autosave)
    .values(values)
    .onConflictDoUpdate({ target: [schema.autosave.entity, schema.autosave.entityId, schema.autosave.userId], set: { baseVersion, payload: values.payload, savedAt: values.savedAt } });
  return values.savedAt;
}

export async function getAutosave(actor: Actor, entity: Entity, entityId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.autosave)
    .where(and(eq(schema.autosave.entity, entity), eq(schema.autosave.entityId, entityId), eq(schema.autosave.userId, actor.id)));
  return row ?? null;
}

export async function clearAutosave(actor: Actor, entity: Entity, entityId: string) {
  const db = await getDb();
  await db.delete(schema.autosave).where(and(eq(schema.autosave.entity, entity), eq(schema.autosave.entityId, entityId), eq(schema.autosave.userId, actor.id)));
}
