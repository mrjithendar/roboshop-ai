"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { finishUpload, requestUpload } from "@/app/admin/_actions/shared";
import { Alert, Button, Field, Input, Select } from "@/components/ui/form";

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,audio/x-wav,application/pdf";
/** Browsers report a few types under legacy names; send the canonical one (the server checks the bytes anyway). */
const CANONICAL: Record<string, string> = { "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg" };

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Upload any allowed file straight from the browser to R2 with a short-lived presigned URL
 * (large videos never pass through the site's pods), then ask the server to verify it.
 */
export function MediaUploader() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const xhr = useRef<XMLHttpRequest | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file.");
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      setStatus("Checking the file…");
      const contentType = CANONICAL[file.type] ?? file.type;
      const intent = await requestUpload({
        filename: file.name,
        contentType,
        size: file.size,
        sha256: await sha256Hex(file),
        alt: String(form.get("alt") ?? ""),
        visibility: String(form.get("visibility") ?? "public"),
        context: "library",
      });
      if (!intent.ok) throw new Error(intent.error);
      setStatus("Uploading…");
      await new Promise<void>((resolve, reject) => {
        const req = new XMLHttpRequest();
        xhr.current = req;
        req.open("PUT", intent.uploadUrl);
        for (const [k, v] of Object.entries(intent.headers)) req.setRequestHeader(k, v);
        req.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
        req.onload = () => (req.status >= 200 && req.status < 300 ? resolve() : reject(new Error(`Upload failed (HTTP ${req.status}). Check the bucket's CORS policy.`)));
        req.onerror = () => reject(new Error("Upload failed: network error or the bucket's CORS policy does not allow this site."));
        req.onabort = () => reject(new Error("Upload cancelled."));
        req.send(file);
      });
      setStatus("Verifying…");
      const done = await finishUpload(intent.id);
      if (!done.ok) throw new Error(done.error);
      setStatus("Uploaded.");
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setStatus(null);
      setError((err as Error).message);
    } finally {
      xhr.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_auto] lg:items-end">
      <Field label="File" htmlFor="file" hint="Images up to 10 MB · MP4/WebM up to 200 MB · MP3/M4A/Ogg/WAV up to 50 MB · PDF up to 20 MB.">
        <Input id="file" name="file" type="file" accept={ACCEPT} required disabled={busy} />
      </Field>
      <Field label="Alt text / description" htmlFor="alt" hint="Required for images.">
        <Input id="alt" name="alt" maxLength={300} disabled={busy} />
      </Field>
      <Field label="Visibility" htmlFor="visibility">
        <Select id="visibility" name="visibility" defaultValue="public" disabled={busy}>
          <option value="public">Public</option>
          <option value="private">Private (staff only)</option>
        </Select>
      </Field>
      {busy && progress !== null ? (
        <Button type="button" variant="secondary" onClick={() => xhr.current?.abort()}>
          Cancel
        </Button>
      ) : (
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Upload"}
        </Button>
      )}
      <div className="space-y-2 sm:col-span-2 lg:col-span-4" aria-live="polite">
        {status && (
          <p className="text-sm text-fg-muted">
            {status}
            {progress !== null && ` ${progress}%`}
          </p>
        )}
        {progress !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </form>
  );
}
