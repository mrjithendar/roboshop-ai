"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import type { MediaItem } from "@/app/admin/_actions/shared";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { AlertIcon, CheckIcon } from "@/components/icons";
import { Button, inputClass } from "@/components/ui/form";
import { AA, contrast, HEX, overlayContrast } from "@/lib/site-config/color";
import { defaultConfig, type Banner, type ImageRef } from "@/lib/site-config/schema";

// --- Path helpers -------------------------------------------------------------------------------------------

export function getIn(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), obj);
}

/** Immutable set: copies each object/array along the path. */
export function setIn<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const node = (obj ?? {}) as Record<string, unknown> | unknown[];
  const copy: Record<string, unknown> | unknown[] = Array.isArray(node) ? [...node] : { ...node };
  (copy as Record<string, unknown>)[head!] = rest.length ? setIn((node as Record<string, unknown>)[head!], rest.join("."), value) : value;
  return copy as T;
}

const DEFAULTS = defaultConfig();

// --- Editing context -----------------------------------------------------------------------------------------

export type EditorApi = {
  draft: unknown;
  set: (path: string, value: unknown) => void;
  issues: { path: string; message: string }[];
};

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error("useEditor outside the appearance editor");
  return api;
}

export function useField<T>(path: string): { value: T; set: (v: T) => void; error?: string; isDefault: boolean; reset: () => void; hasDefault: boolean } {
  const { draft, set, issues } = useEditor();
  const value = getIn(draft, path) as T;
  const def = getIn(DEFAULTS, path);
  const error = issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;
  return {
    value,
    set: (v) => set(path, v),
    error,
    hasDefault: def !== undefined,
    isDefault: JSON.stringify(def) === JSON.stringify(value),
    reset: () => set(path, structuredClone(def)),
  };
}

// --- Layout pieces -------------------------------------------------------------------------------------------

export function Panel({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">{children}</div>;
}

function ResetButton({ field, label }: { field: { isDefault: boolean; hasDefault: boolean; reset: () => void }; label: string }) {
  if (!field.hasDefault || field.isDefault) return null;
  return (
    <button type="button" onClick={field.reset} className="text-xs font-medium text-accent-text hover:underline">
      Reset<span className="sr-only"> {label} to default</span>
    </button>
  );
}

function FieldShell({ id, label, hint, error, field, children }: { id: string; label: string; hint?: ReactNode; error?: string; field: Parameters<typeof ResetButton>[0]["field"]; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="block text-sm font-medium text-fg">
          {label}
        </label>
        <ResetButton field={field} label={label} />
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-fg-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const described = (id: string, error?: string, hint?: ReactNode) =>
  error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : hint ? { "aria-describedby": `${id}-hint` } : {};

// --- Controls -----------------------------------------------------------------------------------------------

export function TextField({ path, label, hint, max, placeholder, type = "text", multiline = false, rows = 3, mono = false }: { path: string; label: string; hint?: ReactNode; max?: number; placeholder?: string; type?: string; multiline?: boolean; rows?: number; mono?: boolean }) {
  const f = useField<string>(path);
  const id = useId();
  const count = max ? `${(f.value ?? "").length}/${max}` : null;
  const help = hint || count ? <>{hint}{hint && count ? " · " : ""}{count}</> : undefined;
  const props = { id, value: f.value ?? "", maxLength: max, placeholder, ...described(id, f.error, help), className: `${inputClass} ${mono ? "font-mono text-sm" : ""}` };
  return (
    <FieldShell id={id} label={label} hint={help} error={f.error} field={f}>
      {multiline ? <textarea {...props} rows={rows} onChange={(e) => f.set(e.target.value)} /> : <input {...props} type={type} onChange={(e) => f.set(e.target.value)} />}
    </FieldShell>
  );
}

export function Toggle({ path, label, hint }: { path: string; label: string; hint?: ReactNode }) {
  const f = useField<boolean>(path);
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-sm text-fg-subtle">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={!!f.value}
        onClick={() => f.set(!f.value)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${f.value ? "border-accent bg-accent" : "border-line-strong bg-surface-sunken"}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${f.value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

export function Choice<T extends string | number>({ path, label, options, hint }: { path: string; label: string; options: { value: T; label: string }[]; hint?: ReactNode }) {
  const f = useField<T>(path);
  const id = useId();
  if (options.length > 4) {
    return (
      <FieldShell id={id} label={label} hint={hint} error={f.error} field={f}>
        <select
          id={id}
          value={String(f.value)}
          onChange={(e) => f.set((typeof options[0]!.value === "number" ? Number(e.target.value) : e.target.value) as T)}
          className={inputClass}
          {...described(id, f.error, hint)}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }
  return (
    <fieldset className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <legend className="text-sm font-medium text-fg">{label}</legend>
        <ResetButton field={f} label={label} />
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg bg-surface-sunken p-1">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className="relative inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium text-fg-muted hover:text-fg has-[:checked]:bg-surface has-[:checked]:text-fg has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
          >
            <input type="radio" name={id} className="sr-only" checked={f.value === o.value} onChange={() => f.set(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {f.error ? <p className="text-sm text-red-700 dark:text-red-300">{f.error}</p> : hint && <p className="text-sm text-fg-subtle">{hint}</p>}
    </fieldset>
  );
}

export function NumberField({ path, label, min, max, step = 1, unit = "", hint }: { path: string; label: string; min: number; max: number; step?: number; unit?: string; hint?: ReactNode }) {
  const f = useField<number>(path);
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={f.error} field={f}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={f.value ?? min}
          onChange={(e) => f.set(Number(e.target.value))}
          className="h-11 min-w-0 flex-1 accent-[var(--accent)]"
          {...described(id, f.error, hint)}
        />
        <output htmlFor={id} className="w-16 shrink-0 text-right text-sm tabular-nums text-fg">
          {f.value}
          {unit}
        </output>
      </div>
    </FieldShell>
  );
}

/** Colour with a live contrast check against `against` (the page background) when given. */
export function ColorField({ path, label, against, hint }: { path: string; label: string; against?: string; hint?: ReactNode }) {
  const f = useField<string>(path);
  const id = useId();
  const valid = HEX.test(f.value ?? "");
  const ratio = valid && against && HEX.test(against) ? contrast(f.value, against) : null;
  return (
    <FieldShell id={id} label={label} hint={hint} error={f.error} field={f}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={valid ? f.value : "#000000"}
          onChange={(e) => f.set(e.target.value)}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
        />
        <input id={id} value={f.value ?? ""} onChange={(e) => f.set(e.target.value.trim().toLowerCase())} maxLength={7} spellCheck={false} className={`${inputClass} font-mono text-sm`} {...described(id, f.error, hint)} />
        {ratio !== null && (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold tabular-nums ${ratio >= AA ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200"}`}>
            {ratio >= AA ? <CheckIcon className="h-3 w-3" /> : <AlertIcon className="h-3 w-3" />}
            {ratio.toFixed(1)}:1
          </span>
        )}
      </div>
    </FieldShell>
  );
}

// --- Images ---------------------------------------------------------------------------------------------------

function toRef(item: MediaItem): ImageRef {
  return { src: item.src, width: item.width, height: item.height, alt: item.alt, decorative: !item.alt, focalX: 50, focalY: 50, fit: "cover" };
}

/** Pick an image from the media library (upload included), with alt text, decorative flag, focal point and fit. */
export function ImageField({ path, label, hint, focal = true, fit = true }: { path: string; label: string; hint?: ReactNode; focal?: boolean; fit?: boolean }) {
  const f = useField<ImageRef | null>(path);
  const [open, setOpen] = useState(false);
  const img = f.value;
  const set = (patch: Partial<ImageRef>) => img && f.set({ ...img, ...patch });
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-line p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-fg">{label}</p>
        <ResetButton field={f} label={label} />
      </div>
      {hint && <p className="-mt-2 text-sm text-fg-subtle">{hint}</p>}
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-sunken">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
            <img src={img.src} alt="" className={`h-full w-full ${img.fit === "contain" ? "object-contain" : "object-cover"}`} style={{ objectPosition: `${img.focalX}% ${img.focalY}%` }} />
          ) : (
            <span className="text-xs text-fg-subtle">No image</span>
          )}
          {img && focal && <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow" style={{ left: `${img.focalX}%`, top: `${img.focalY}%` }} aria-hidden="true" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {img ? "Replace" : "Choose image"}
          </Button>
          {img && (
            <Button type="button" variant="ghost" size="sm" onClick={() => f.set(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {img && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
            <input type="checkbox" checked={img.decorative} onChange={(e) => set({ decorative: e.target.checked })} />
            Decorative (no description for screen readers)
          </label>
          {!img.decorative && (
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="block font-medium text-fg">Alt text</span>
              <input value={img.alt} maxLength={300} onChange={(e) => set({ alt: e.target.value })} className={inputClass} aria-invalid={!img.alt || undefined} />
            </label>
          )}
          {focal && (
            <>
              <label className="space-y-1 text-sm">
                <span className="block font-medium text-fg">Focal point, horizontal ({img.focalX}%)</span>
                <input type="range" min={0} max={100} value={img.focalX} onChange={(e) => set({ focalX: Number(e.target.value) })} className="h-9 w-full accent-[var(--accent)]" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block font-medium text-fg">Focal point, vertical ({img.focalY}%)</span>
                <input type="range" min={0} max={100} value={img.focalY} onChange={(e) => set({ focalY: Number(e.target.value) })} className="h-9 w-full accent-[var(--accent)]" />
              </label>
            </>
          )}
          {fit && (
            <label className="space-y-1 text-sm">
              <span className="block font-medium text-fg">Fit</span>
              <select value={img.fit} onChange={(e) => set({ fit: e.target.value as ImageRef["fit"] })} className={inputClass}>
                <option value="cover">Fill the area (crop)</option>
                <option value="contain">Show the whole image</option>
              </select>
            </label>
          )}
          <p className="self-end text-xs text-fg-subtle sm:col-span-2">
            {img.width} × {img.height} px · {img.src}
          </p>
        </div>
      )}
      {f.error && <p className="text-sm text-red-700 dark:text-red-300">{f.error}</p>}
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(item) => {
          f.set(toRef(item));
          setOpen(false);
        }}
        context="appearance"
        title={`Choose: ${label}`}
      />
    </div>
  );
}

/** Background image with mobile crop, overlay and a live worst-case contrast check for white text. */
export function BannerField({ path, label, showHeight = true }: { path: string; label: string; showHeight?: boolean }) {
  const f = useField<Banner>(path);
  const b = f.value;
  const ratio = HEX.test(b.overlayColor) ? overlayContrast("#ffffff", b.overlayColor, b.overlayOpacity) : 0;
  return (
    <div className="space-y-4">
      <ImageField path={`${path}.desktop`} label={`${label}: desktop image`} hint="At least 1600 px wide works best." />
      <ImageField path={`${path}.mobile`} label={`${label}: mobile image (optional)`} hint="Shown below 640 px wide; a taller crop usually reads better." />
      <Grid>
        <ColorField path={`${path}.overlayColor`} label="Overlay colour" />
        <NumberField path={`${path}.overlayOpacity`} label="Overlay opacity" min={0} max={90} step={5} unit="%" />
      </Grid>
      {showHeight && (
        <Choice
          path={`${path}.height`}
          label="Height"
          options={[
            { value: "sm", label: "Small" },
            { value: "md", label: "Medium" },
            { value: "lg", label: "Large" },
          ]}
        />
      )}
      <p role="status" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${ratio >= AA ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100" : "bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"}`}>
        {ratio >= AA ? <CheckIcon className="h-4 w-4 shrink-0" /> : <AlertIcon className="h-4 w-4 shrink-0" />}
        Text over this image stays at least {ratio.toFixed(1)}:1 whatever the photo looks like{ratio >= AA ? "." : ". Use a darker overlay or a higher opacity (4.5:1 is required to publish)."}
      </p>
    </div>
  );
}

/** A link destination: a site path or an https URL (validated on the server too). */
export function LinkField({ path, label, hint }: { path: string; label: string; hint?: ReactNode }) {
  return <TextField path={path} label={label} hint={hint ?? "A site path like /blog, or an https:// link."} max={300} placeholder="/blog" />;
}
