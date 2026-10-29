"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPreviewAction } from "@/app/admin/_actions/shared";
import { Button } from "@/components/ui/form";
import type { PreviewKind } from "@/lib/preview";
import { Dialog } from "../Dialog";

export function Panel({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-2xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold text-fg">
        {title}
        <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

export type SaveState =
  | { kind: "saved"; at?: string; message?: string }
  | { kind: "saving" }
  | { kind: "autosaving" }
  | { kind: "autosaved"; at: string }
  | { kind: "error"; message: string };

/** Save status, announced to screen readers. */
export function SaveIndicator({ state, dirty, status }: { state: SaveState; dirty: boolean; status: string }) {
  let text: string;
  let tone = "text-slate-500";
  if (state.kind === "saving") text = "Saving…";
  else if (state.kind === "autosaving") text = "Autosaving…";
  else if (state.kind === "error") {
    text = state.message;
    tone = "text-red-600";
  } else if (dirty) {
    text = state.kind === "autosaved" ? `Unsaved changes (autosaved ${new Date(state.at).toLocaleTimeString()})` : "Unsaved changes";
    tone = "text-amber-700 dark:text-amber-300";
  } else text = state.kind === "saved" && state.message ? state.message : `Saved · ${status}`;
  return (
    <p role="status" aria-live="polite" className={`min-w-0 flex-1 truncate text-sm ${tone}`} title={text}>
      {text}
    </p>
  );
}

/** Approximation of a search result; real engines choose their own titles and snippets. */
export function SearchPreview({ url, title, description }: { url: string; title: string; description: string }) {
  return (
    <figure className="rounded-xl border border-line p-3 text-left">
      <figcaption className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">Search result (approximation)</figcaption>
      <p className="truncate text-xs text-fg-muted">{url}</p>
      <p className="mt-0.5 line-clamp-2 text-base text-[#1a0dab] dark:text-[#8ab4f8]">{title || "Title"} | Jithendar.com</p>
      <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted">{description || "Description"}</p>
    </figure>
  );
}

/** Approximation of a large social card. */
export function SocialPreview({ title, description, image }: { title: string; description: string; image?: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line">
      <figcaption className="px-3 pt-2 text-[11px] uppercase tracking-wide text-slate-400">Social card (approximation)</figcaption>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- editor preview
        <img src={image} alt="" className="mt-2 aspect-[1.91/1] w-full object-cover" />
      ) : (
        <div className="mt-2 flex aspect-[1.91/1] items-center justify-center bg-slate-100 text-xs text-slate-500 dark:bg-white/5">Generated title card</div>
      )}
      <div className="space-y-0.5 p-3">
        <p className="text-xs uppercase text-slate-500">jithendar.com</p>
        <p className="line-clamp-2 text-sm font-semibold text-fg">{title || "Title"}</p>
        <p className="line-clamp-2 text-xs text-fg-muted">{description}</p>
      </div>
    </figure>
  );
}

type Rev = { id: string; version: number; reason: string; createdAt: string; author: string | null };

export function RevisionsPanel({ list, load, preview, kind }: { list: () => Promise<Rev[]>; load: (id: string) => Promise<void>; preview: (id: string) => Promise<unknown>; kind: PreviewKind }) {
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    list().then((r) => live && setRevs(r)).catch(() => live && setError("Could not load revisions."));
    return () => {
      live = false;
    };
  }, [list]);
  async function open(id: string) {
    const tab = window.open("about:blank", "_blank");
    const r = await createPreviewAction(kind, await preview(id));
    if (r.ok && tab) tab.location.href = `/preview/${r.token}`;
    else tab?.close();
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!revs) return <p className="text-sm text-slate-500">Loading…</p>;
  if (revs.length === 0) return <p className="text-sm text-slate-500">No revisions yet.</p>;
  return (
    <ol className="max-h-72 space-y-2 overflow-y-auto">
      {revs.map((r) => (
        <li key={r.id} className="rounded-lg border border-line p-2 text-xs">
          <p className="font-medium text-fg">
            v{r.version} · {r.reason}
          </p>
          <p className="text-slate-500">
            {new Date(r.createdAt).toLocaleString()} · {r.author ?? "system"}
          </p>
          <div className="mt-1 flex gap-3">
            <button type="button" className="font-semibold underline" onClick={() => open(r.id)}>Preview</button>
            <button type="button" className="font-semibold underline" onClick={() => load(r.id)}>Load into editor</button>
          </div>
        </li>
      ))}
    </ol>
  );
}

const DEVICES = [
  { id: "mobile", label: "Mobile", width: 390 },
  { id: "tablet", label: "Tablet", width: 820 },
  { id: "desktop", label: "Desktop", width: 1280 },
] as const;

/**
 * Renders the unsaved document with the real site components (/preview/<token>, staff-only, noindex,
 * never cached) in an iframe at device widths. Changing the width keeps the same snapshot; edits stay in the editor.
 */
export function PreviewDialog({ open, onClose, kind, payload }: { open: boolean; onClose: () => void; kind: PreviewKind; payload: unknown }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setToken(null);
      setError(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    let live = true;
    createPreviewAction(kind, payload).then((r) => {
      if (!live) return;
      if (r.ok) setToken(r.token);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- one snapshot per opening
  const width = DEVICES.find((d) => d.id === device)!.width;
  return (
    <Dialog open={open} onClose={onClose} title="Preview" footer={
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Device width" className="flex gap-1">
          {DEVICES.map((d) => (
            <Button key={d.id} type="button" variant={device === d.id ? "primary" : "secondary"} aria-pressed={device === d.id} onClick={() => setDevice(d.id)}>
              {d.label}
            </Button>
          ))}
        </div>
        {token && <a href={`/preview/${token}`} target="_blank" rel="noopener" className="text-sm font-semibold underline">Open in a new tab ↗</a>}
      </div>
    }>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!token && !error && <p className="text-sm text-slate-500">Rendering…</p>}
      {token && (
        <div className="overflow-x-auto rounded-xl border border-line bg-slate-100 p-2 dark:bg-black/30">
          <iframe title={`Preview at ${width}px`} src={`/preview/${token}`} style={{ width }} className="mx-auto block h-[70dvh] max-w-none rounded-lg border-0 bg-white" />
        </div>
      )}
    </Dialog>
  );
}
