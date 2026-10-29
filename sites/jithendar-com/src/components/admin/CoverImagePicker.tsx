"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { FeaturedImage } from "@/db/schema";
import { Button, Field, Input } from "@/components/ui/form";
import { GenerateImageDialog, type GenerateOptions } from "./GenerateImageDialog";
import { MediaPicker } from "./MediaPicker";

const clamp = (n: number) => Math.round(Math.min(Math.max(n, 0), 100));

/**
 * Choose, generate, replace or remove a post's cover image. Alt text is required and editable.
 * Clicking the preview sets the focal point that card crops keep in view.
 */
export function CoverImagePicker({
  value,
  onChange,
  context,
  generate,
  label = "Cover image",
}: {
  label?: string;
  value: FeaturedImage | null;
  onChange: (v: FeaturedImage | null) => void;
  context: string;
  generate?: GenerateOptions & { title: string; summary: string };
}) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const focalX = value?.focalX ?? 50;
  const focalY = value?.focalY ?? 50;

  function setFocal(e: MouseEvent<HTMLButtonElement>) {
    if (!value) return;
    const r = e.currentTarget.getBoundingClientRect();
    onChange({ ...value, focalX: clamp(((e.clientX - r.left) / r.width) * 100), focalY: clamp(((e.clientY - r.top) / r.height) * 100) });
  }
  function nudgeFocal(e: KeyboardEvent<HTMLButtonElement>) {
    if (!value) return;
    const step = e.shiftKey ? 10 : 2;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onChange({ ...value, focalX: clamp(focalX + d[0]!), focalY: clamp(focalY + d[1]!) });
  }

  const generateButton = generate && (
    <Button type="button" variant="secondary" onClick={() => setGenerating(true)} disabled={!generate.enabled} title={generate.enabled ? "Create an image with Gemini" : generate.reason}>
      ✨ Generate image
    </Button>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-ink dark:text-white">{label}</p>
      {value ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
          <button
            type="button"
            onClick={setFocal}
            onKeyDown={nudgeFocal}
            className="relative block w-full cursor-crosshair"
            aria-label={`Focal point ${focalX}% across, ${focalY}% down. Click the image or use the arrow keys to move it.`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- editor preview */}
            <img src={value.src} alt={value.alt} className="aspect-[16/9] w-full object-cover" style={{ objectPosition: `${focalX}% ${focalY}%` }} />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.5)]"
              style={{ left: `${focalX}%`, top: `${focalY}%` }}
            />
          </button>
          <div className="space-y-3 p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">Click the image to set the focal point kept in view when cards crop it.</p>
            <Field label="Alt text" htmlFor="cover-alt">
              <Input id="cover-alt" value={value.alt} onChange={(e) => onChange({ ...value, alt: e.target.value })} required />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
                Change
              </Button>
              {generateButton}
              <Button type="button" variant="ghost" onClick={() => onChange(null)}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-3 text-center text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/15 dark:text-slate-400"
          >
            <span className="text-2xl" aria-hidden="true">
              ＋
            </span>
            Select or upload a cover image
            <span className="text-xs">Shown on cards, at the top of the post and when shared.</span>
          </button>
          {generateButton && <div className="flex">{generateButton}</div>}
        </div>
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
      {generate && (
        <GenerateImageDialog
          open={generating}
          onClose={() => setGenerating(false)}
          onAccept={(image) => {
            onChange(image);
            setGenerating(false);
          }}
          title={generate.title}
          summary={generate.summary}
          context={context}
          options={generate}
          replacing={Boolean(value)}
        />
      )}
    </div>
  );
}
