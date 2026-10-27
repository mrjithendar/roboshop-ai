import { count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { ROLES, type Role } from "./auth";
import { invalidateContent } from "./content";
import type { Actor } from "./posts";
import { PostError } from "./posts";

function adminOnly(actor: Actor) {
  if (actor.role !== "admin") throw new PostError("Only admins can manage users.", 403);
}

export async function listUsers() {
  const db = await getDb();
  return db
    .select({ user: schema.user, profile: schema.authorProfile.slug })
    .from(schema.user)
    .leftJoin(schema.authorProfile, eq(schema.authorProfile.userId, schema.user.id))
    .orderBy(desc(schema.user.createdAt))
    .limit(500);
}

async function adminCount() {
  const db = await getDb();
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.user).where(eq(schema.user.role, "admin"));
  return n;
}

const slugFrom = (name: string, id: string) =>
  `${name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 40) || "author"}-${id.slice(0, 4).toLowerCase()}`;

/** Change a role. Authors/admins get a public author profile if they do not have one. */
export async function setRole(actor: Actor, userId: string, role: string) {
  adminOnly(actor);
  if (!ROLES.includes(role as Role)) throw new PostError("Unknown role.");
  if (userId === actor.id) throw new PostError("You cannot change your own role.");
  const db = await getDb();
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!u) throw new PostError("User not found.", 404);
  if (u.role === "admin" && role !== "admin" && (await adminCount()) <= 1) throw new PostError("There must always be at least one admin.");
  await db.update(schema.user).set({ role, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  if (role !== "user") {
    await db.insert(schema.authorProfile).values({ userId, slug: slugFrom(u.name, u.id), displayName: u.name }).onConflictDoNothing();
  }
  await audit(actor, "user.role", userId, { from: u.role, to: role });
  invalidateContent();
}

/** Ban or unban; banning ends all of the user's sessions immediately. */
export async function setBanned(actor: Actor, userId: string, banned: boolean, reason = "") {
  adminOnly(actor);
  if (userId === actor.id) throw new PostError("You cannot ban yourself.");
  const db = await getDb();
  await db.update(schema.user).set({ banned, banReason: banned ? reason || null : null, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  if (banned) await db.delete(schema.session).where(eq(schema.session.userId, userId));
  await audit(actor, banned ? "user.ban" : "user.unban", userId);
}

export async function deleteUser(actor: Actor, userId: string) {
  adminOnly(actor);
  if (userId === actor.id) throw new PostError("You cannot delete your own account here.");
  const db = await getDb();
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.post).where(eq(schema.post.authorId, userId));
  if (n > 0) throw new PostError(`This user wrote ${n} post(s). Reassign or delete those posts first, or ban the account instead.`, 409);
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  await audit(actor, "user.delete", userId);
  invalidateContent();
}
