"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { Alert, Button, buttonClass } from "@/components/ui/form";
import { removeAvatarAction, uploadAvatarAction, type AccountResult } from "./actions";

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";

export function AvatarEditor({ name, image, enabled, maxMb }: { name: string; image: string | null; enabled: boolean; maxMb: number }) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<AccountResult | null>(null);
  const [pending, start] = useTransition();

  // Revoke the preview's object URL when it changes or the component unmounts.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | null) {
    setResult(null);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  function reset() {
    choose(null);
    if (input.current) input.current.value = "";
  }

  function upload() {
    if (!file) return;
    const form = new FormData();
    form.set("avatar", file);
    start(async () => {
      const r = await uploadAvatarAction(form);
      setResult(r);
      if (r.ok) {
        reset();
        router.refresh();
      }
    });
  }

  function remove() {
    start(async () => {
      const r = await removeAvatarAction();
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img src={preview} alt="Preview of the new avatar" width={80} height={80} className="h-20 w-20 shrink-0 rounded-full object-cover" />
      ) : (
        <UserAvatar name={name} image={image} size="lg" />
      )}
      <div className="min-w-0 flex-1 space-y-3">
        {enabled ? (
          <>
            <div className="flex flex-wrap gap-2">
              {file ? (
                <>
                  <Button type="button" onClick={upload} loading={pending}>
                    {pending ? "Uploading…" : "Save new avatar"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <label htmlFor={inputId} className={`${buttonClass("secondary")} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent`}>
                    {image ? "Replace avatar" : "Upload avatar"}
                    <input ref={input} id={inputId} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
                  </label>
                  {image && (
                    <Button type="button" variant="ghost" onClick={remove} loading={pending}>
                      Remove
                    </Button>
                  )}
                </>
              )}
            </div>
            <p className="text-sm text-fg-subtle">
              JPEG, PNG, WebP, AVIF or GIF, up to {maxMb} MB. It is cropped to a square and re-saved without location or camera data.
            </p>
          </>
        ) : (
          <p className="text-sm leading-6 text-fg-muted">
            Avatar uploads are not available yet. Your initials are shown instead.
            {image && (
              <>
                {" "}
                <button type="button" onClick={remove} className="link" disabled={pending}>
                  Remove the current avatar
                </button>
              </>
            )}
          </p>
        )}
        {result && <Alert tone={result.ok ? "success" : "error"}>{result.ok ? result.message : result.error}</Alert>}
      </div>
    </div>
  );
}
