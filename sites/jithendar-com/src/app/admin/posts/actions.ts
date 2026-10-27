"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { run, staffActor, type ActionResult } from "@/lib/admin";
import { createPost, deletePost, updatePost } from "@/lib/posts";

export async function savePost(id: string | null, data: unknown): Promise<ActionResult> {
  const actor = await staffActor();
  return run(
    () => (id ? updatePost(actor, id, data) : createPost(actor, data)),
    (row) => ({ ok: true, id: row.id, message: row.status === "published" ? "Published." : "Saved." }),
  );
}

export async function removePost(id: string): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => deletePost(actor, id));
  revalidatePath("/admin/posts");
  return result;
}

/** Bulk status change / delete; each post goes through the same permission and validation checks. */
export async function bulkPosts(ids: string[], action: "publish" | "draft" | "archive" | "delete"): Promise<ActionResult> {
  const actor = await staffActor();
  const failures: string[] = [];
  const db = await getDb();
  const rows = await db.select({ id: schema.post.id, title: schema.post.title, publishedAt: schema.post.publishedAt }).from(schema.post).where(inArray(schema.post.id, ids.slice(0, 200)));
  for (const row of rows) {
    const result = await run(async () => {
      if (action === "delete") return deletePost(actor, row.id);
      await updatePost(actor, row.id, {
        status: action === "publish" ? "published" : action === "archive" ? "archived" : "draft",
        ...(action === "publish" && !row.publishedAt ? { publishedAt: new Date().toISOString() } : {}),
      });
    });
    if (!result.ok) failures.push(`${row.title}: ${result.issues?.[0] ?? result.error}`);
  }
  revalidatePath("/admin/posts");
  return failures.length ? { ok: false, error: `${rows.length - failures.length} done, ${failures.length} failed.`, issues: failures } : { ok: true, message: `${rows.length} updated.` };
}
