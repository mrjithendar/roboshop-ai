"use client";

import { useState } from "react";
import type { FeaturedImage } from "@/db/schema";
import { Button, Field, Input } from "@/components/ui/form";
import { MediaPicker } from "./MediaPicker";

/** Choose, replace or remove a post's cover image; alt text is required and editable. */
export function CoverImagePicker({ value, onChange, context }: { value: FeaturedImage | null; onChange: (v: FeaturedImage | null) => void; context: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-ink dark:text-white">Cover image</p>
      {value ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element -- editor preview */}
          <img src={value.src} alt={value.alt} className="aspect-[16/9] w-full object-cover" />
          <div className="space-y-3 p-3">
            <Field label="Alt text" htmlFor="cover-alt">
              <Input id="cover-alt" value={value.alt} onChange={(e) => onChange({ ...value, alt: e.target.value })} required />
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
                Change
              </Button>
              <Button type="button" variant="ghost" onClick={() => onChange(null)}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/15 dark:text-slate-400"
        >
          <span className="text-2xl" aria-hidden="true">
            ＋
          </span>
          Select a cover image
          <span className="text-xs">Shown on cards, at the top of the post and when shared.</span>
        </button>
      )}
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        title="Choose a cover image"
        context={context}
        onSelect={(item) => {
          onChange({ src: item.src, alt: value?.alt || item.alt, width: item.width, height: item.height });
          setOpen(false);
        }}
      />
    </div>
  );
}
