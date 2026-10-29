"use client";

import { useEffect, useRef, useState } from "react";
import { acceptGeneratedImage, discardGeneratedImage } from "@/app/admin/_actions/shared";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { FeaturedImage } from "@/db/schema";
import { Dialog } from "./Dialog";

export type GenerateOptions = { enabled: boolean; reason?: string; aspectRatios: readonly string[] };

type Result = { id: string; previewUrl: string; width: number; height: number; model: string };
type Phase = { name: "compose" } | { name: "generating" } | { name: "preview"; result: Result };

export function defaultPrompt(title: string, summary: string): string {
  const parts = [
    `Editorial cover illustration for a technology article titled "${title.trim() || "Untitled"}".`,
    summary.trim(),
    "Clean, modern, professional style suitable for a blog header. No text, letters, logos or watermarks.",
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * Generate an image with Gemini, preview it, then Use as cover / Regenerate / Discard.
 * Nothing changes on the post until the author accepts, and even then only in the editor: the
 * post itself changes when it is saved. Unaccepted results are discarded on close.
 */
export function GenerateImageDialog({
  open,
  onClose,
  onAccept,
  title,
  summary,
  context,
  options,
  replacing,
}: {
  open: boolean;
  onClose: () => void;
  onAccept: (image: FeaturedImage) => void;
  title: string;
  summary: string;
  context: string;
  options: GenerateOptions;
  replacing: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState(options.aspectRatios[0] ?? "16:9");
  const [phase, setPhase] = useState<Phase>({ name: "compose" });
  const [alt, setAlt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pendingId = useRef<string | null>(null);

  // Each time the dialog opens, start from the article's current title and summary.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPrompt(defaultPrompt(title, summary));
      setPhase({ name: "compose" });
      setError(null);
      setAlt("");
    }
  }

  // Leaving the dialog never keeps an unaccepted result or a running request.
  useEffect(() => {
    if (open) return;
    controller.current?.abort();
    if (pendingId.current) void discardGeneratedImage(pendingId.current);
    pendingId.current = null;
  }, [open]);

  async function generate() {
    if (controller.current) return; // already running: no duplicate requests
    if (pendingId.current) {
      void discardGeneratedImage(pendingId.current);
      pendingId.current = null;
    }
    setError(null);
    setPhase({ name: "generating" });
    const ac = new AbortController();
    controller.current = ac;
    try {
      const res = await fetch("/api/admin/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspectRatio: ratio }),
        signal: ac.signal,
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Result> & { error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "Image generation failed.");
      pendingId.current = body.id;
      setPhase({ name: "preview", result: body as Result });
    } catch (e) {
      setPhase({ name: "compose" });
      setError(ac.signal.aborted ? "Generation cancelled." : (e as Error).message);
    } finally {
      controller.current = null;
    }
  }

  function cancel() {
    controller.current?.abort();
  }

  async function discard() {
    if (pendingId.current) await discardGeneratedImage(pendingId.current);
    pendingId.current = null;
    setPhase({ name: "compose" });
  }

  async function accept(result: Result) {
    setSaving(true);
    setError(null);
    const r = await acceptGeneratedImage(result.id, alt, context);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    pendingId.current = null;
    onAccept(r.image);
  }

  const generating = phase.name === "generating";
  const footer =
    phase.name === "preview" ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={discard} disabled={saving}>
          Discard
        </Button>
        <Button type="button" variant="secondary" onClick={generate} disabled={saving}>
          Regenerate
        </Button>
        <Button type="button" onClick={() => accept(phase.result)} disabled={saving || !alt.trim()}>
          {saving ? "Saving…" : "Use as cover"}
        </Button>
      </div>
    ) : (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {generating ? (
          <Button type="button" variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
        <Button type="button" onClick={generate} disabled={generating || prompt.trim().length < 10}>
          {generating ? "Generating…" : "Generate"}
        </Button>
      </div>
    );

  return (
    <Dialog open={open} onClose={onClose} title="Generate an image" size="md" footer={footer}>
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        {phase.name === "preview" ? (
          <>
            <figure className="overflow-hidden rounded-xl border border-line bg-surface-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- private, unaccepted preview (not optimisable) */}
              <img
                src={phase.result.previewUrl}
                alt={alt || "Generated image preview"}
                width={phase.result.width}
                height={phase.result.height}
                className="h-auto max-h-[50dvh] w-full object-contain"
              />
              <figcaption className="px-3 py-2 text-xs text-fg-subtle">
                {phase.result.width}×{phase.result.height} · {phase.result.model} · not saved yet
              </figcaption>
            </figure>
            <Field label="Alt text" htmlFor="gen-alt" hint="Describe what the image shows, for screen readers and search. Required.">
              <Input id="gen-alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} required data-autofocus />
            </Field>
            {replacing && <Alert tone="info">Using this image replaces the current cover in the editor. The post changes only when you save it.</Alert>}
          </>
        ) : (
          <>
            <Field label="Prompt" htmlFor="gen-prompt" hint="Prefilled from the title and summary. Describe the subject, style and mood; avoid asking for text in the image.">
              <Textarea id="gen-prompt" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} disabled={generating} data-autofocus />
            </Field>
            <Field label="Aspect ratio" htmlFor="gen-ratio" hint="Covers are shown at 16:9 on cards; other shapes are cropped to fit.">
              <Select id="gen-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)} disabled={generating}>
                {options.aspectRatios.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            {generating && (
              <p role="status" className="flex items-center gap-3 text-sm text-fg-muted">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden="true" />
                Generating… this can take up to a minute.
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
