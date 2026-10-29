"use server";

import { revalidatePath } from "next/cache";
import { adminActor } from "@/lib/admin";
import { getPublishedContent } from "@/lib/content";
import { log } from "@/lib/log";
import { PostError } from "@/lib/posts";
import { hit } from "@/lib/rate-limit";
import type { SiteConfig } from "@/lib/site-config/schema";
import {
  ConfigConflictError,
  discardDraft,
  exportConfig,
  getDraft,
  listRevisions,
  previewImport,
  publishDraft,
  restoreRevision,
  saveDraft,
  type Issue,
} from "@/lib/site-config/store";

export type Conflict = { version: number; config: unknown; updatedAt: string | null };
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; issues?: string[]; conflict?: Conflict };

/** Every action re-checks the admin role on the server; the UI hiding things is never the protection. */
async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (error) {
    if (error instanceof ConfigConflictError) {
      const d = error.latest;
      return { ok: false, error: error.message, conflict: { version: d.version, config: d.config, updatedAt: d.updatedAt?.toISOString() ?? null } };
    }
    if (error instanceof PostError) return { ok: false, error: error.message, issues: error.issues.length ? error.issues : undefined };
    if ((error as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw error;
    log.error("appearance action failed", { err: error });
    return { ok: false, error: "Something went wrong. The error has been logged." };
  }
}

export async function saveDraftAction(config: unknown, version: number): Promise<Result<{ version: number; issues: Issue[] }>> {
  return run(async () => {
    const actor = await adminActor();
    if (!(await hit(`site-config:${actor.id}`, 240, 600))) throw new PostError("Too many saves in a short time. Wait a moment and try again.", 429);
    return saveDraft(actor, config, version);
  });
}

export async function publishAction(version: number, note: string): Promise<Result<{ version: number }>> {
  return run(async () => {
    const actor = await adminActor();
    const result = await publishDraft(actor, version, note);
    revalidatePath("/", "layout");
    return result;
  });
}

export async function discardDraftAction(): Promise<Result<{ version: number; config: unknown }>> {
  return run(async () => {
    const actor = await adminActor();
    await discardDraft(actor);
    const d = await getDraft();
    return { version: d.version, config: d.config };
  });
}

export async function listRevisionsAction(): Promise<Result<{ revisions: { id: string; version: number; reason: string; author: string | null; createdAt: string }[] }>> {
  return run(async () => {
    await adminActor();
    return { revisions: (await listRevisions()).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });
}

export async function restoreRevisionAction(id: string, mode: "draft" | "publish", version: number): Promise<Result<{ version: number; config: unknown }>> {
  return run(async () => {
    const actor = await adminActor();
    await restoreRevision(actor, id, mode === "publish" ? "publish" : "draft", version);
    if (mode === "publish") revalidatePath("/", "layout");
    const d = await getDraft();
    return { version: d.version, config: d.config };
  });
}

export async function exportAction(which: "published" | "draft"): Promise<Result<{ json: string }>> {
  return run(async () => {
    await adminActor();
    return { json: await exportConfig(which === "draft" ? "draft" : "published") };
  });
}

export async function previewImportAction(text: string): Promise<Result<{ config: SiteConfig; changes: string[]; warnings: string[] }>> {
  return run(async () => {
    await adminActor();
    if (typeof text !== "string") throw new PostError("Choose a file.");
    return previewImport(text);
  });
}

/** Search published articles for the homepage pickers (titles and paths only). */
export async function searchArticlesAction(q: string): Promise<Result<{ items: { path: string; title: string; collection: string }[] }>> {
  return run(async () => {
    await adminActor();
    const term = String(q ?? "").trim().toLowerCase().slice(0, 100);
    const all = await getPublishedContent();
    const items = all
      .filter((a) => !term || a.frontmatter.title.toLowerCase().includes(term) || a.slug.includes(term))
      .slice(0, 20)
      .map((a) => ({ path: a.path, title: a.frontmatter.title, collection: a.collection }));
    return { items };
  });
}
