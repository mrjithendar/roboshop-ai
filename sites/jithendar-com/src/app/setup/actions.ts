"use server";

import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { invalidateContent } from "@/lib/content";
import { importFromFiles } from "@/lib/content/import";

const input = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(12).max(128),
});

export type SetupState = { error?: string };

export async function adminExists(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, "admin")).limit(1);
  return rows.length > 0;
}

function tokenMatches(given: string): boolean {
  const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expected || expected.length < 32) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Create the first admin (only while none exists), link the author profile and import the MDX content. */
export async function setupAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  if (await adminExists()) return { error: "Setup is already complete." };
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the fields: name, a valid email and a password of at least 12 characters." };
  if (!tokenMatches(parsed.data.token)) return { error: "Invalid setup token." };

  const { name, email, password } = parsed.data;
  const auth = await getAuth();
  const ctx = await auth.$context;
  const db = await getDb();
  const userId = crypto.randomUUID();
  const hash = await ctx.password.hash(password);

  await db.transaction(async (tx) => {
    await tx.insert(schema.user).values({ id: userId, name, email, emailVerified: true, role: "admin" });
    await tx.insert(schema.account).values({ id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: hash });
  });

  const root = process.env.CONTENT_SEED_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "content");
  const authorSlug = "jithendar-dharmapuri";
  const imported = await importFromFiles(db, root, new Map([[authorSlug, userId]]));
  const author = imported.authors.get(authorSlug);
  await db
    .insert(schema.authorProfile)
    .values({
      userId,
      slug: authorSlug,
      displayName: author?.frontmatter.name ?? name,
      jobTitle: author?.frontmatter.jobTitle ?? null,
      bio: author?.body ?? "",
      sameAs: author?.frontmatter.sameAs ?? [],
    })
    .onConflictDoNothing();

  await audit({ id: userId, label: email }, "setup.complete", userId, { postsImported: imported.posts, pagesImported: imported.pages });
  invalidateContent();
  redirect("/login?setup=done");
}
