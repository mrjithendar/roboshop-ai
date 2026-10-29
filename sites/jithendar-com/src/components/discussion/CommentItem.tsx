"use client";

import { useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { CheckIcon, CopyIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { UserAvatar } from "@/components/UserAvatar";
import { Alert, Button, Field, Textarea } from "@/components/ui/form";
import { REPORT_NOTE_MAX, REPORT_REASONS, reportReasonLabels, type CommentView, type ReportReason } from "@/lib/comment-types";
import { Composer, type ComposerSubmit } from "./Composer";

export type ItemHandlers = {
  reply: (parent: CommentView, body: string, token: string | null, clientKey: string) => ReturnType<ComposerSubmit>;
  edit: (comment: CommentView, body: string) => ReturnType<ComposerSubmit>;
  remove: (comment: CommentView) => Promise<string | null>;
  like: (comment: CommentView) => void;
  report: (comment: CommentView, reason: ReportReason, note: string) => Promise<{ ok: boolean; message: string }>;
  /** Source text for editing (fetched on demand: pages carry only rendered HTML). */
  source: (comment: CommentView) => Promise<string | null>;
};

const actionClass =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-55";

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </svg>
  );
}

function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 6 6v5" />
    </svg>
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 21V4m0 0h11l-2 4 2 4H5" />
    </svg>
  );
}

export function CommentItem({
  comment: c,
  level,
  path,
  siteKey,
  formatTime,
  highlight,
  signInHref,
  signedIn,
  handlers,
}: {
  comment: CommentView;
  level: number;
  path: string;
  siteKey?: string;
  formatTime: (iso: string) => string;
  highlight: string | null;
  signInHref: (anchor: string) => string;
  signedIn: boolean;
  handlers: ItemHandlers;
}) {
  const [mode, setMode] = useState<"view" | "reply" | "edit">("view");
  const [editSource, setEditSource] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const anchor = `comment-${c.id}`;
  const headingId = `${anchor}-by`;

  async function startEdit() {
    setEditError(null);
    const source = await handlers.source(c);
    if (source === null) return setEditError("This comment could not be loaded for editing. Please try again.");
    setEditSource(source);
    setMode("edit");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}#${anchor}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.location.hash = anchor;
    }
  }

  const replies =
    c.replies.length > 0 ? (
      <ol className={`mt-4 space-y-5 border-l-2 border-line pl-3 sm:pl-5`} aria-label={`Replies to ${c.author?.name ?? "a removed comment"}`}>
        {c.replies.map((r) => (
          <li key={r.id}>
            <CommentItem comment={r} level={level + 1} path={path} siteKey={siteKey} formatTime={formatTime} highlight={highlight} signInHref={signInHref} signedIn={signedIn} handlers={handlers} />
          </li>
        ))}
      </ol>
    ) : null;

  if (c.tombstone) {
    return (
      <article id={anchor} tabIndex={-1} className="scroll-mt-24 rounded-lg outline-none" aria-label="Unavailable comment">
        <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm italic text-fg-subtle">This comment is no longer available.</p>
        {replies}
      </article>
    );
  }

  const author = c.author!;
  return (
    <article
      id={anchor}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={`scroll-mt-24 rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent ${highlight === c.id ? "ring-2 ring-accent/60 ring-offset-4 ring-offset-canvas" : ""}`}
    >
      <div className="flex gap-3">
        <UserAvatar name={author.name} image={author.image} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <h3 id={headingId} className="font-semibold text-fg [overflow-wrap:anywhere]">
              {author.name}
            </h3>
            {author.badge && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text">{author.badge === "admin" ? "Admin" : "Author"}</span>
            )}
            <a href={`#${anchor}`} className="text-fg-subtle hover:text-fg hover:underline" title={`Link to this comment (${c.createdAt})`}>
              <time dateTime={c.createdAt}>{formatTime(c.createdAt)}</time>
            </a>
            {c.editedAt && <span className="text-fg-subtle" title={`Edited ${formatTime(c.editedAt)}`}>· edited</span>}
            {c.pending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Awaiting approval · only you can see this</span>}
          </header>
          {c.replyTo && (
            <p className="mt-1 text-xs text-fg-subtle">
              <a href={`#comment-${c.replyTo.id}`} className="hover:text-fg hover:underline">
                ↪ Replying to {c.replyTo.name ?? "an unavailable comment"}
              </a>
            </p>
          )}

          {mode === "edit" && editSource !== null ? (
            <div className="mt-3">
              <Composer
                label="Edit your comment"
                submitLabel="Save changes"
                pendingLabel="Saving…"
                initial={editSource}
                verify={false}
                autoFocus
                onCancel={() => setMode("view")}
                onSubmit={async (body) => {
                  const r = await handlers.edit(c, body);
                  if (r.ok) setMode("view");
                  return r;
                }}
              />
            </div>
          ) : (
            // Sanitised on the server (lib/comment-markdown): only basic formatting, safe links, no raw HTML.
            <div className="comment-body mt-1.5" dangerouslySetInnerHTML={{ __html: c.html }} />
          )}

          {mode !== "edit" && (
            <div className="-ml-2 mt-2 flex flex-wrap items-center gap-0.5">
              {c.can.like || c.likes > 0 || c.likedByMe ? (
                <button
                  type="button"
                  className={`${actionClass} ${c.likedByMe ? "text-accent-text" : ""}`}
                  aria-pressed={c.can.like ? c.likedByMe : undefined}
                  aria-label={c.can.like ? `${c.likedByMe ? "Unlike" : "Like"} comment by ${author.name}. ${c.likes} ${c.likes === 1 ? "like" : "likes"}` : `${c.likes} ${c.likes === 1 ? "like" : "likes"}`}
                  disabled={!c.can.like}
                  onClick={() => handlers.like(c)}
                >
                  <HeartIcon filled={c.likedByMe} className="h-4 w-4" />
                  {c.likes > 0 && <span aria-hidden="true">{c.likes}</span>}
                </button>
              ) : null}
              {c.can.reply ? (
                <button type="button" className={actionClass} aria-expanded={mode === "reply"} onClick={() => setMode(mode === "reply" ? "view" : "reply")}>
                  <ReplyIcon className="h-4 w-4" /> Reply
                </button>
              ) : !signedIn && !c.pending ? (
                <a href={signInHref(anchor)} className={actionClass}>
                  <ReplyIcon className="h-4 w-4" /> Sign in to reply
                </a>
              ) : null}
              <button type="button" className={actionClass} onClick={copyLink} aria-label={`Copy link to comment by ${author.name}`}>
                {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Link"}</span>
              </button>
              <span role="status" aria-live="polite" className="sr-only">
                {copied ? "Link copied" : ""}
              </span>
              {c.can.edit && (
                <button type="button" className={actionClass} onClick={startEdit}>
                  <PencilIcon className="h-4 w-4" /> Edit
                </button>
              )}
              {c.can.delete && (
                <button type="button" className={actionClass} onClick={() => setConfirmDelete(true)}>
                  <TrashIcon className="h-4 w-4" /> Delete
                </button>
              )}
              {c.can.report && (
                <button type="button" className={actionClass} onClick={() => setReporting(true)} aria-label={`Report comment by ${author.name}`}>
                  <FlagIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Report</span>
                </button>
              )}
              {c.reportedByMe && <span className="px-2 text-xs text-fg-subtle">Reported</span>}
            </div>
          )}
          {editError && (
            <div className="mt-2">
              <Alert>{editError}</Alert>
            </div>
          )}

          {mode === "reply" && (
            <div className="mt-3">
              <Composer
                label={`Reply to ${author.name}`}
                submitLabel="Post reply"
                siteKey={siteKey}
                verify
                autoFocus
                onCancel={() => setMode("view")}
                onSubmit={async (body, token, key) => {
                  const r = await handlers.reply(c, body, token, key);
                  if (r.ok) setMode("view");
                  return r;
                }}
              />
            </div>
          )}
        </div>
      </div>

      {replies}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this comment?"
        size="md"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deleting}
              onClick={async () => {
                setDeleting(true);
                setDeleteError(null);
                const error = await handlers.remove(c);
                setDeleting(false);
                if (error) setDeleteError(error);
                else setConfirmDelete(false);
              }}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-fg-muted">
          The text is erased and cannot be restored. {c.replies.length > 0 ? "Replies stay, under a “no longer available” note." : ""}
        </p>
        {deleteError && (
          <div className="mt-4">
            <Alert>{deleteError}</Alert>
          </div>
        )}
      </Dialog>

      {reporting && <ReportDialog name={author.name} onClose={() => setReporting(false)} onSubmit={(reason, note) => handlers.report(c, reason, note)} />}
    </article>
  );
}

function ReportDialog({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (reason: ReportReason, note: string) => Promise<{ ok: boolean; message: string }> }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const done = result?.ok;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Report comment by ${name}`}
      size="md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done && (
            <Button
              type="button"
              loading={busy}
              disabled={!reason || busy}
              onClick={async () => {
                if (!reason) return;
                setBusy(true);
                setResult(await onSubmit(reason, note));
                setBusy(false);
              }}
            >
              Send report
            </Button>
          )}
        </div>
      }
    >
      {done ? (
        <Alert tone="success">{result.message}</Alert>
      ) : (
        <div className="space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-fg">Why should a moderator look at this?</legend>
            <div className="mt-3 space-y-2">
              {REPORT_REASONS.map((r) => (
                <label key={r} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm text-fg has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                  <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4 accent-[var(--accent)]" />
                  {reportReasonLabels[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Details" htmlFor="report-note" optional hint="Only moderators see this.">
            <Textarea id="report-note" rows={3} value={note} maxLength={REPORT_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {result && !result.ok && <Alert>{result.message}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
