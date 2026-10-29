"use client";

import { useId, useRef, useState, useTransition } from "react";
import { previewCommentAction } from "@/app/_actions/comments";
import { Turnstile } from "@/components/Turnstile";
import { Alert, Button, Spinner, Textarea } from "@/components/ui/form";

const MAX = 5000;

export type ComposerSubmit = (body: string, token: string | null, clientKey: string) => Promise<{ ok: true } | { ok: false; error: string }>;

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Write / Preview composer for new comments, replies and edits. Preview is rendered on the server by the same
 * sanitiser that renders published comments. New comments and replies carry a Turnstile token and a client key
 * (one per draft: a double click or a retried request cannot post the same comment twice).
 */
export function Composer({
  label,
  submitLabel,
  pendingLabel = "Posting…",
  initial = "",
  siteKey,
  verify,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  pendingLabel?: string;
  initial?: string;
  siteKey?: string;
  /** Needs the human check (new comments and replies). */
  verify: boolean;
  autoFocus?: boolean;
  onSubmit: ComposerSubmit;
  onCancel?: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState(initial);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState<{ html?: string; error?: string; loading?: boolean }>({});
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const clientKey = useRef(newKey());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const length = body.trim().length;
  const tooLong = body.length > MAX;

  if (verify && !siteKey) return <Alert tone="info">Commenting is unavailable right now: human verification is not configured.</Alert>;

  async function showPreview() {
    setTab("preview");
    if (length < 2) {
      setPreview({ error: "Nothing to preview yet." });
      return;
    }
    setPreview({ loading: true });
    const r = await previewCommentAction(body);
    setPreview(r.ok ? { html: r.html } : { error: r.error });
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (pending) return;
    setError(null);
    if (length < 2) return setError("Write a comment first.");
    if (tooLong) return setError(`Comments can be up to ${MAX} characters.`);
    if (verify && !token) return setError("Please complete the human verification.");
    start(async () => {
      const r = await onSubmit(body, token, clientKey.current);
      if (verify) {
        // Turnstile tokens are single-use.
        setToken(null);
        setResetKey((k) => k + 1);
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setBody("");
      setTab("write");
      clientKey.current = newKey();
    });
  }

  const tabClass = (on: boolean) =>
    `min-h-9 rounded-md px-3 text-sm font-semibold transition-colors ${on ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`;

  return (
    <form onSubmit={submit} className="space-y-3" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-body`} className="text-sm font-medium text-fg">
          {label}
        </label>
        <div role="group" aria-label="Editor mode" className="inline-flex rounded-lg bg-surface-sunken p-1">
          <button type="button" aria-pressed={tab === "write"} className={tabClass(tab === "write")} onClick={() => { setTab("write"); requestAnimationFrame(() => textarea.current?.focus()); }}>
            Write
          </button>
          <button type="button" aria-pressed={tab === "preview"} className={tabClass(tab === "preview")} onClick={showPreview}>
            Preview
          </button>
        </div>
      </div>
      <div hidden={tab !== "write"}>
        <Textarea
          ref={textarea}
          id={`${id}-body`}
          rows={4}
          value={body}
          autoFocus={autoFocus}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            if (e.key === "Escape" && onCancel && !body.trim()) onCancel();
          }}
          maxLength={MAX + 500}
          aria-invalid={tooLong || undefined}
          aria-describedby={`${id}-help`}
          placeholder="Add to the discussion…"
        />
      </div>
      {tab === "preview" && (
        <div className="min-h-[7.5rem] rounded-[var(--radius-control)] border border-line bg-surface-muted px-3.5 py-2.5" aria-live="polite" aria-busy={preview.loading || undefined}>
          {preview.loading && (
            <p className="flex items-center gap-2 text-sm text-fg-subtle">
              <Spinner /> Rendering preview…
            </p>
          )}
          {preview.error && <p className="text-sm text-fg-subtle">{preview.error}</p>}
          {preview.html && <div className="comment-body" dangerouslySetInnerHTML={{ __html: preview.html }} />}
        </div>
      )}
      <p id={`${id}-help`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-fg-subtle">
        <span>
          Markdown: **bold**, _italic_, `code`, ``` code blocks ```, &gt; quotes, lists and links. Your name and avatar are shown with your comment.
        </span>
        <span className={tooLong ? "font-semibold text-red-700 dark:text-red-300" : ""}>
          {body.length}/{MAX}
        </span>
      </p>
      {verify && siteKey && <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} />}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
