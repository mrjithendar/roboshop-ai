import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Actor } from "./posts";
import { PostError } from "./posts";

export type PreviewKind = "post" | "page";
const TTL_MS = 60 * 60 * 1000;
const MAX_PAYLOAD = 400_000;

/** Store the editor's current (possibly unsaved) content and return an unguessable token. */
export async function createPreview(actor: Actor, kind: PreviewKind, payload: unknown): Promise<string> {
  if (actor.role !== "admin" && actor.role !== "author") throw new PostError("Not allowed.", 403);
  if (JSON.stringify(payload ?? null).length > MAX_PAYLOAD) throw new PostError("This post is too large to preview.", 400);
  const db = await getDb();
  await db.delete(schema.preview).where(lt(schema.preview.expiresAt, new Date()));
  const token = randomBytes(24).toString("base64url");
  await db.insert(schema.preview).values({ token, kind, payload: payload as object, userId: actor.id, expiresAt: new Date(Date.now() + TTL_MS) });
  return token;
}

/** The preview, if it exists, has not expired, and belongs to the viewer (admins may view any). */
export async function readPreview(actor: Actor, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const db = await getDb();
  const [row] = await db.select().from(schema.preview).where(and(eq(schema.preview.token, token)));
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  if (row.userId !== actor.id && actor.role !== "admin") return null;
  return { kind: row.kind as PreviewKind, payload: row.payload };
}
