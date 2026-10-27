import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";

/**
 * Bootstrap helpers for /setup. Deliberately NOT in a "use server" module: nothing here may be
 * callable from the browser. Only the token-checked setup action uses them.
 */

export async function adminExists(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, "admin")).limit(1);
  return rows.length > 0;
}

/**
 * The setup token proves the operator, so an existing account with the same email (for example one
 * created from the sign-up form) is upgraded to admin: the password entered here replaces its
 * password, the email is marked verified and its sessions are ended. Otherwise a new admin is created.
 */
export async function createOrPromoteAdmin(db: Db, { name, email, hash }: { name: string; email: string; hash: string }): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
    if (existing) {
      await tx.update(schema.user).set({ name, role: "admin", emailVerified: true, banned: false, updatedAt: new Date() }).where(eq(schema.user.id, existing.id));
      const [credential] = await tx
        .select({ id: schema.account.id })
        .from(schema.account)
        .where(and(eq(schema.account.userId, existing.id), eq(schema.account.providerId, "credential")));
      if (credential) await tx.update(schema.account).set({ password: hash, updatedAt: new Date() }).where(eq(schema.account.id, credential.id));
      else await tx.insert(schema.account).values({ id: crypto.randomUUID(), accountId: existing.id, providerId: "credential", userId: existing.id, password: hash });
      await tx.delete(schema.session).where(eq(schema.session.userId, existing.id));
      return existing.id;
    }
    const id = crypto.randomUUID();
    await tx.insert(schema.user).values({ id, name, email, emailVerified: true, role: "admin" });
    await tx.insert(schema.account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: hash });
    return id;
  });
}
