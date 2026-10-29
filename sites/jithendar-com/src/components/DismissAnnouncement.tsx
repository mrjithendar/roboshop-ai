"use client";

import { CloseIcon } from "./icons";

export function DismissAnnouncement({ id, storageKey }: { id: string; storageKey: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.setItem(storageKey, id);
        } catch {
          /* storage blocked: hide for this page view only */
        }
        document.documentElement.classList.add("announcement-dismissed");
        document.getElementById("main")?.focus({ preventScroll: true });
      }}
      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md opacity-80 hover:bg-current/10 hover:opacity-100"
    >
      <CloseIcon className="h-4 w-4" />
      <span className="sr-only">Dismiss announcement</span>
    </button>
  );
}
