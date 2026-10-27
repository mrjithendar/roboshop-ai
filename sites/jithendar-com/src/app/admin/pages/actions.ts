"use server";

import { revalidatePath } from "next/cache";
import { run, staffActor, type ActionResult } from "@/lib/admin";
import { deletePage, savePage } from "@/lib/site-pages";

export async function savePageAction(originalSlug: string | null, data: unknown): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => savePage(actor, originalSlug, data), (slug) => ({ ok: true, id: slug, message: "Saved." }));
  revalidatePath("/admin/pages");
  return result;
}

export async function deletePageAction(slug: string): Promise<ActionResult> {
  const actor = await staffActor();
  const result = await run(() => deletePage(actor, slug));
  revalidatePath("/admin/pages");
  return result;
}
