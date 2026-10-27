"use client";

import { createPreviewAction } from "@/app/admin/_actions/shared";
import type { PreviewKind } from "@/lib/preview";

/**
 * Open the editor's current (unsaved) content in a new tab. The tab is opened synchronously inside the
 * click so pop-up blockers allow it, then pointed at /preview/<token> once the preview is stored.
 */
export async function openPreview(kind: PreviewKind, payload: unknown): Promise<string | null> {
  const tab = window.open("about:blank", "_blank");
  const result = await createPreviewAction(kind, payload);
  if (!result.ok) {
    tab?.close();
    return result.error;
  }
  const url = `/preview/${result.token}`;
  if (tab) tab.location.href = url;
  else window.open(url, "_blank");
  return null;
}
