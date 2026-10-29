"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { listMedia, mediaUploadsEnabled, uploadMedia, type MediaItem } from "@/app/admin/_actions/shared";
import { Alert, Button, Field, Input } from "@/components/ui/form";
import { Dialog } from "./Dialog";

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";

/**
 * Pick an image from the media library (search, pages), or upload one by choosing, dropping or
 * pasting a file. Uploads are validated server-side and stored in R2; only possible when storage is configured.
 */
export function MediaPicker({
  open,
  onClose,
  onSelect,
  context = "library",
  title = "Choose an image",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: MediaItem) => void;
  context?: string;
  title?: string;
}) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [uploads, setUploads] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      Promise.all([listMedia({ q, page }), page === 1 ? mediaUploadsEnabled() : Promise.resolve(null)]).then(([list, enabled]) => {
        if (cancelled) return;
        setItems((prev) => (page === 1 ? list.items : [...(prev ?? []), ...list.items]));
        setMore(list.more);
        if (enabled !== null) setUploads(enabled);
      });
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, q, page]);

  if (!open) return null;

  function choose(f: File | null | undefined) {
    if (!f) return;
    if (!ACCEPT.split(",").includes(f.type)) return setError("Use a JPEG, PNG, WebP, AVIF or GIF image.");
    setError(null);
    setFile(f);
  }

  function upload() {
    if (!file) return setError("Choose, drop or paste an image first.");
    if (!alt.trim()) return setError("Alt text is required.");
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt.trim());
    form.set("context", context);
    setError(null);
    start(async () => {
      const result = await uploadMedia(form);
      if (!result.ok) return setError(result.error);
      setFile(null);
      setAlt("");
      onSelect({ id: result.id, src: result.src, alt: alt.trim(), width: result.width, height: result.height, context });
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-6" onPaste={(e) => uploads && choose(Array.from(e.clipboardData.files)[0])}>
        {uploads ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}
            className={`grid gap-4 rounded-xl border-2 border-dashed p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end ${dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-300 dark:border-white/15"}`}
          >
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink dark:text-white">Upload a new image</p>
              <button type="button" onClick={() => fileInput.current?.click()} className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-left text-sm dark:border-white/15 dark:bg-surface-dark-raised">
                {file ? file.name : "Choose a file, drop it here, or paste"}
              </button>
              <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => choose(e.target.files?.[0])} />
              <p className="text-xs text-slate-500">JPEG, PNG, WebP, AVIF or GIF, up to 10 MB.</p>
            </div>
            <Field label="Alt text" htmlFor="mp-alt" hint="Describe the image for screen readers.">
              <Input id="mp-alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} />
            </Field>
            <Button type="button" onClick={upload} disabled={pending} className="w-full sm:w-auto">
              {pending ? "Uploading…" : "Upload"}
            </Button>
            {pending && <div role="progressbar" aria-label="Uploading" className="h-1.5 overflow-hidden rounded-full bg-slate-200 sm:col-span-3 dark:bg-white/10"><div className="h-full w-1/3 animate-pulse bg-brand-600" /></div>}
          </div>
        ) : (
          <Alert tone="info">Uploads are off until an admin configures media storage (Cloudflare R2) under Admin → Storage. You can still pick existing images.</Alert>
        )}
        {error && <Alert>{error}</Alert>}
        <Field label="Search the library" htmlFor="mp-search">
          <Input id="mp-search" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Alt text or file name" />
        </Field>
        {items === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">No images found.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="group block w-full overflow-hidden rounded-xl border border-slate-200 text-left focus-visible:ring-4 focus-visible:ring-brand-500/30 dark:border-white/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnails, no optimisation needed */}
                  <img src={item.src} alt={item.alt} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" />
                  <span className="block truncate px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300">{item.alt || "No alt text"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {more && (
          <div className="text-center">
            <Button type="button" variant="secondary" onClick={() => setPage((p) => p + 1)}>Load more</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
