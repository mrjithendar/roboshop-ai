"use client";

import { useEffect, useState, useTransition } from "react";
import { listMedia, mediaUploadsEnabled, uploadMedia, type MediaItem } from "@/app/admin/_actions/shared";
import { Alert, Button, Field, Input } from "@/components/ui/form";

/** Modal: pick an image from the Media library, or upload one (only when S3 storage is configured). */
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
  const [uploads, setUploads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([listMedia(), mediaUploadsEnabled()]).then(([list, enabled]) => {
      if (cancelled) return;
      setItems(list);
      setUploads(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function upload(form: FormData) {
    setError(null);
    form.set("context", context);
    start(async () => {
      const result = await uploadMedia(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSelect({ id: result.id, src: result.src, alt: String(form.get("alt")), width: result.width, height: result.height, context });
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="media-picker-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-surface-dark-raised">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-white/10">
          <h2 id="media-picker-title" className="font-semibold text-ink dark:text-white">
            {title}
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {uploads ? (
            <form action={upload} className="grid gap-4 rounded-xl border border-dashed border-slate-300 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-white/15">
              <Field label="Upload a new image" htmlFor="mp-file" hint="JPEG, PNG, WebP, AVIF or GIF, up to 5 MB.">
                <Input id="mp-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" required />
              </Field>
              <Field label="Alt text" htmlFor="mp-alt" hint="Describe the image for screen readers.">
                <Input id="mp-alt" name="alt" required maxLength={200} />
              </Field>
              <Button type="submit" disabled={pending}>
                {pending ? "Uploading…" : "Upload"}
              </Button>
            </form>
          ) : (
            <Alert tone="info">Uploads are off until an admin configures media storage (S3) under Admin → Storage. You can still pick existing images.</Alert>
          )}
          {error && <Alert>{error}</Alert>}
          {items === null ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500">No images in the library yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
        </div>
      </div>
    </div>
  );
}
