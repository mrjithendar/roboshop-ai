"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { run, staffActor, type ActionResult } from "@/lib/admin";
import { rowToForm, type PostFormValue } from "@/lib/post-form";
import {
  ConflictError,
  createPost,
  deletePostPermanently,
  duplicatePost,
  getPostRow,
  PostError,
  publishPost,
  restorePost,
  trashPost,
  updatePost,
  type PostRow,
} from "@/lib/posts";
import { clearAutosave, getRevision, listRevisions, saveAutosave } from "@/lib/revisions";

export type SaveIntent = "save" | "publish" | "unpublish";
export type SaveResult =
  | { ok: true; id: string; version: number; status: string; savedAt: string; publishedAt: string | null; message: string }
  | { ok: false; error: string; issues?: string[]; conflict?: { version: number; savedAt: string } };

const ok = (row: PostRow, message: string): SaveResult => ({
  ok: true,
  id: row.id,
  version: row.version,
  status: row.status,
  savedAt: row.savedAt.toISOString(),
  publishedAt: row.publishedAt?.toISOString() ?? null,
  message,
});

function failure(error: unknown): SaveResult {
  if (error instanceof ConflictError) return { ok: false, error: error.message, conflict: error.current };
  if (error instanceof PostError) return { ok: false, error: error.message, issues: error.issues };
  throw error;
}

/**
 * Commit the editor's value. "save" keeps the status (Save draft / Update), "publish" publishes now or
 * schedules (future date), "unpublish" returns it to draft. `baseVersion` guards against overwriting a
 * newer save from another tab or editor; pass the latest version to overwrite deliberately.
 */
export async function savePostAction(id: string | null, data: PostFormValue, intent: SaveIntent, baseVersion?: number): Promise<SaveResult> {
  const actor = await staffActor();
  try {
    if (!id) {
      const created = await createPost(actor, { ...data, status: data.status === "published" || data.status === "scheduled" ? "draft" : data.status });
      if (intent !== "publish") return ok(created, "Draft saved.");
      const row = await publishPost(actor, created.id, { ...data }, { baseVersion: created.version });
      return ok(row, row.status === "scheduled" ? "Scheduled." : "Published.");
    }
    if (intent === "publish") {
      const row = await publishPost(actor, id, { ...data }, { baseVersion });
      return ok(row, row.status === "scheduled" ? "Scheduled." : "Published.");
    }
    if (intent === "unpublish") {
      const row = await updatePost(actor, id, { ...data, status: "draft" }, { baseVersion, reason: "unpublish" });
      return ok(row, "Switched to draft. It is no longer public.");
    }
    // Saving a scheduled or published post keeps its status (Update); drafts stay drafts.
    const row = await updatePost(actor, id, data, { baseVersion });
    return ok(row, row.status === "published" ? "Updated." : row.status === "scheduled" ? "Saved. Still scheduled." : "Draft saved.");
  } catch (error) {
    return failure(error);
  } finally {
    revalidatePath("/admin/posts");
  }
}

/** Debounced autosave: the user's working copy, never visible to readers until committed. */
export async function autosavePostAction(id: string, baseVersion: number, data: PostFormValue): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const actor = await staffActor();
  try {
    await getPostRow(actor, id);
    const at = await saveAutosave(actor, "post", id, baseVersion, data);
    return { ok: true, savedAt: at.toISOString() };
  } catch (error) {
    return { ok: false, error: error instanceof PostError ? error.message : "Autosave failed." };
  }
}

export async function discardAutosaveAction(id: string): Promise<void> {
  const actor = await staffActor();
  await clearAutosave(actor, "post", id);
}

/** Latest committed version (after a conflict). */
export async function loadLatestPostAction(id: string): Promise<{ value: PostFormValue; version: number }> {
  const actor = await staffActor();
  const row = await getPostRow(actor, id);
  return { value: rowToForm(row), version: row.version };
}

export async function listPostRevisionsAction(id: string) {
  const actor = await staffActor();
  await getPostRow(actor, id);
  return (await listRevisions("post", id)).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Load a revision into the editor (not saved until the author saves, which adds a new revision). */
export async function loadPostRevisionAction(id: string, revisionId: string): Promise<PostFormValue> {
  const actor = await staffActor();
  await getPostRow(actor, id);
  const rev = await getRevision("post", id, revisionId);
  return rowToForm(rev.payload);
}

/** Live check for the permalink field. */
export async function checkSlugAction(collection: string, slug: string, id: string | null): Promise<{ available: boolean }> {
  await staffActor();
  const db = await getDb();
  const [clash] = await db
    .select({ id: schema.post.id })
    .from(schema.post)
    .where(and(eq(schema.post.collection, collection), eq(schema.post.slug, slug), id ? ne(schema.post.id, id) : undefined));
  return { available: !clash };
}

export async function trashPostAction(id: string): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => trashPost(actor, id), () => ({ ok: true, message: "Moved to the trash." }));
  revalidatePath("/admin/posts");
  return result;
}

/** Backwards-compatible name used by older callers. */
export async function removePost(id: string): Promise<ActionResult> {
  return trashPostAction(id);
}

export async function duplicatePostAction(id: string): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => duplicatePost(actor, id), (row) => ({ ok: true, id: row.id, message: "Duplicated as a new draft." }));
  revalidatePath("/admin/posts");
  return result;
}

/** Bulk actions; each post goes through the same permission and validation checks. */
export async function bulkPosts(ids: string[], action: "publish" | "draft" | "archive" | "trash" | "restore" | "delete"): Promise<ActionResult> {
  const actor = await staffActor();
  const failures: string[] = [];
  const db = await getDb();
  const rows = await db.select({ id: schema.post.id, title: schema.post.title }).from(schema.post).where(inArray(schema.post.id, ids.slice(0, 200)));
  for (const row of rows) {
    const result = await run(async () => {
      if (action === "trash") return trashPost(actor, row.id);
      if (action === "restore") return restorePost(actor, row.id);
      if (action === "delete") return deletePostPermanently(actor, row.id);
      if (action === "publish") return void (await publishPost(actor, row.id, {}));
      await updatePost(actor, row.id, { status: action === "archive" ? "archived" : "draft" });
    });
    if (!result.ok) failures.push(`${row.title}: ${result.issues?.[0] ?? result.error}`);
  }
  revalidatePath("/admin/posts");
  return failures.length ? { ok: false, error: `${rows.length - failures.length} done, ${failures.length} failed.`, issues: failures } : { ok: true, message: `${rows.length} updated.` };
}

/** Preview a post's committed version from the list (staff-only token, noindex, not cached). */
export async function previewPostAction(id: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const actor = await staffActor();
  try {
    const { createPreview } = await import("@/lib/preview");
    return { ok: true, token: await createPreview(actor, "post", rowToForm(await getPostRow(actor, id))) };
  } catch (error) {
    return { ok: false, error: error instanceof PostError ? error.message : "Preview is unavailable." };
  }
}
