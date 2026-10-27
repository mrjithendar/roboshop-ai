"use server";

import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { redirect } from "next/navigation";
import { z } from "zod";
import { passwordProblem } from "@/lib/password-policy";
import { getDb, schema } from "@/db";
import { adminExists, createOrPromoteAdmin } from "@/lib/setup";
import { audit } from "@/lib/audit";
import { hashPassword } from "better-auth/crypto";
import { invalidateContent } from "@/lib/content";
import { importFromFiles } from "@/lib/content/import";

const input = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase(),
  password: z.string().superRefine((v, ctx) => {
    const problem = passwordProblem(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  }),
});

export type SetupState = { error?: string };

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
  if (!parsed.success) return { error: parsed.error.issues.find((i) => i.path[0] === "password")?.message ?? "Check the fields: name and a valid email." };
  if (!tokenMatches(parsed.data.token)) return { error: "Invalid setup token." };

  const { name, email, password } = parsed.data;
  const db = await getDb();
  // Better Auth's default hasher (what its email/password sign-in verifies). The context-bound
  // ctx.password.hash() only works inside Better Auth's own endpoints.
  const hash = await hashPassword(password);
  const userId = await createOrPromoteAdmin(db, { name, email, hash });

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
