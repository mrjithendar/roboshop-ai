"use server";

import { revalidatePath } from "next/cache";
import { run, staffActor, type ActionResult } from "@/lib/admin";
import { ConflictError, PostError } from "@/lib/posts";
import { clearAutosave, getAutosave, getRevision, listRevisions, saveAutosave } from "@/lib/revisions";
import { deletePage, pageRowToForm, restorePage, savePage, trashPage, type PageFormValue } from "@/lib/site-pages";

export type PageSaveResult =
  | { ok: true; slug: string; version: number; savedAt: string; message: string }
  | { ok: false; error: string; issues?: string[]; conflict?: { version: number; savedAt: string } };

export async function savePageAction(originalSlug: string | null, data: PageFormValue, baseVersion?: number): Promise<PageSaveResult> {
  const actor = await staffActor();
  try {
    const row = await savePage(actor, originalSlug, data, { baseVersion });
    return { ok: true, slug: row.slug, version: row.version, savedAt: row.savedAt.toISOString(), message: "Saved. The page is live." };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, error: error.message.replace("post", "page"), conflict: error.current };
    if (error instanceof PostError) return { ok: false, error: error.message, issues: error.issues };
    throw error;
  } finally {
    revalidatePath("/admin/pages");
  }
}

export async function autosavePageAction(slug: string, baseVersion: number, data: PageFormValue) {
  const actor = await staffActor();
  try {
    return { ok: true as const, savedAt: (await saveAutosave(actor, "page", slug, baseVersion, data)).toISOString() };
  } catch {
    return { ok: false as const, error: "Autosave failed." };
  }
}

export async function discardPageAutosaveAction(slug: string) {
  const actor = await staffActor();
  await clearAutosave(actor, "page", slug);
}

export async function pageAutosave(slug: string) {
  const actor = await staffActor();
  return getAutosave(actor, "page", slug);
}

export async function listPageRevisionsAction(slug: string) {
  await staffActor();
  return (await listRevisions("page", slug)).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function loadPageRevisionAction(slug: string, revisionId: string): Promise<PageFormValue> {
  await staffActor();
  return pageRowToForm((await getRevision("page", slug, revisionId)).payload);
}

export async function trashPageAction(slug: string): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => trashPage(actor, slug), () => ({ ok: true, message: "Moved to the trash." }));
  revalidatePath("/admin/pages");
  return result;
}

export async function restorePageAction(slug: string): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => restorePage(actor, slug), () => ({ ok: true, message: "Restored." }));
  revalidatePath("/admin/pages");
  return result;
}

export async function deletePageAction(slug: string): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => deletePage(actor, slug), () => ({ ok: true, message: "Deleted permanently." }));
  revalidatePath("/admin/pages");
  return result;
}
