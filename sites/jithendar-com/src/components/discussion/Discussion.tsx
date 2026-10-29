"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commentSourceAction,
  deleteCommentAction,
  editCommentAction,
  likeCommentAction,
  postCommentAction,
  reportCommentAction,
} from "@/app/_actions/comments";
import { Alert, Button, buttonClass, Spinner } from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";
import type { CommentPage, CommentSort, CommentView } from "@/lib/comment-types";
import { loginHref } from "@/lib/safe-next";
import { CommentItem, type ItemHandlers } from "./CommentItem";
import { Composer } from "./Composer";
import { appendPage, commentIdFromHash, containsComment, updateComment, upsertThread } from "./tree";

type Status = "ready" | "loading" | "error";

function timeFormatter(timeZone: string) {
  const locale = timeZone === "Asia/Kolkata" ? "en-IN" : timeZone.startsWith("America/") ? "en-US" : "en-GB";
  const f = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
  return (iso: string) => f.format(new Date(iso));
}

/**
 * The discussion under a post. The first page arrives with the article (public view: approved comments only);
 * signed-in readers then load their own view (likes, pending comments, permissions) from /api/comments.
 */
export function Discussion({ postId, path, initial, siteKey, timeZone }: { postId: string; path: string; initial: CommentPage; siteKey?: string; timeZone: string }) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [sort, setSort] = useState<CommentSort>("oldest");
  const [threads, setThreads] = useState<CommentView[]>(initial.threads);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [total, setTotal] = useState(initial.total);
  const [state, setState] = useState(initial.state);
  const [status, setStatus] = useState<Status>("ready");
  const [moreStatus, setMoreStatus] = useState<Status>("ready");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "error"; text: string } | null>(null);
  const [live, setLive] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const formatTime = useMemo(() => timeFormatter(timeZone), [timeZone]);
  const viewerId = session?.user.id ?? null;
  const loadedFor = useRef<string | null | undefined>(undefined);
  const signedIn = !!session && !sessionEnded;

  const signInHref = useCallback((anchor: string) => loginHref(`${path}#${anchor}`), [path]);

  const fetchPage = useCallback(
    async (params: Record<string, string>): Promise<CommentPage> => {
      const qs = new URLSearchParams(params);
      const res = await fetch(`/api/comments/${postId}?${qs}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(res.status === 404 ? "Comments are closed." : "Comments could not be loaded.");
      return (await res.json()) as CommentPage;
    },
    [postId],
  );

  const load = useCallback(
    async (nextSort: CommentSort) => {
      setStatus("loading");
      setError(null);
      try {
        const page = await fetchPage({ sort: nextSort });
        let list = page.threads;
        // Opened from a permalink to a comment that is not on the first page: show its thread first.
        const target = commentIdFromHash(window.location.hash);
        if (target && !containsComment(list, target)) {
          const focus = await fetchPage({ focus: target }).catch(() => null);
          if (focus?.threads[0]) list = [focus.threads[0], ...list.filter((t) => t.id !== focus.threads[0]!.id)];
        }
        setThreads(list);
        setNextCursor(page.nextCursor);
        setTotal(page.total);
        setState(page.state);
        setStatus("ready");
        if (target && containsComment(list, target)) {
          setHighlight(target);
          requestAnimationFrame(() => {
            const el = document.getElementById(`comment-${target}`);
            el?.scrollIntoView({ block: "center" });
            el?.focus({ preventScroll: true });
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Comments could not be loaded.");
        setStatus("error");
      }
    },
    [fetchPage],
  );

  // Load the viewer's own view once the session is known (and again if the account changes),
  // or when arriving on a comment permalink.
  useEffect(() => {
    if (sessionPending || loadedFor.current === viewerId) return;
    const first = loadedFor.current === undefined;
    loadedFor.current = viewerId;
    if (viewerId || !first || commentIdFromHash(window.location.hash)) void load(sort);
  }, [sessionPending, viewerId, load, sort]);

  async function loadMore() {
    if (!nextCursor) return;
    setMoreStatus("loading");
    try {
      const page = await fetchPage({ sort, cursor: nextCursor });
      setThreads((t) => appendPage(t, page.threads));
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      setMoreStatus("ready");
      setLive(`${page.threads.length} more ${page.threads.length === 1 ? "thread" : "threads"} loaded.`);
    } catch {
      setMoreStatus("error");
    }
  }

  function changeSort(next: CommentSort) {
    if (next === sort) return;
    setSort(next);
    void load(next);
  }

  /** Session ended while writing: say so, keep the page. */
  function handleResult<T extends { ok: boolean; signedOut?: true; error?: string }>(r: T): T {
    if (!r.ok && r.signedOut) setSessionEnded(true);
    return r;
  }

  function focusComment(id: string) {
    setHighlight(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${id}`);
      el?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
    });
  }

  async function post(body: string, token: string | null, clientKey: string, parent: CommentView | null) {
    const r = handleResult(await postCommentAction({ postId, parentId: parent?.id ?? null, body, clientKey, token }));
    if (!r.ok) return { ok: false as const, error: r.error };
    if (r.thread) setThreads((t) => upsertThread(t, r.thread!, sort));
    if (r.status === "approved") setTotal((n) => n + 1);
    setNotice({ tone: r.status === "approved" ? "success" : "info", text: r.message ?? "Posted." });
    setLive(r.message ?? "");
    focusComment(r.id);
    return { ok: true as const };
  }

  const handlers: ItemHandlers = {
    reply: (parent, body, token, key) => post(body, token, key, parent),
    async edit(comment, body) {
      const r = handleResult(await editCommentAction(postId, comment.id, body));
      if (!r.ok) return { ok: false, error: r.error };
      if (r.thread) setThreads((t) => upsertThread(t, r.thread!, sort));
      setLive("Comment updated.");
      return { ok: true };
    },
    async remove(comment) {
      const r = handleResult(await deleteCommentAction(postId, comment.id));
      if (!r.ok) return r.error;
      setThreads((t) => (r.thread ? upsertThread(t, r.thread, sort) : t.filter((x) => x.id !== comment.id)));
      if (!comment.pending) setTotal((n) => Math.max(0, n - 1));
      setLive("Comment deleted.");
      return null;
    },
    like(comment) {
      const liked = !comment.likedByMe;
      // Optimistic; corrected from the server's answer (or rolled back on error).
      setThreads((t) => updateComment(t, comment.id, (c) => ({ ...c, likedByMe: liked, likes: Math.max(0, c.likes + (liked ? 1 : -1)) })));
      void likeCommentAction(comment.id, liked).then((r) => {
        handleResult(r);
        setThreads((t) => updateComment(t, comment.id, (c) => (r.ok ? { ...c, likedByMe: r.liked, likes: r.likes } : { ...c, likedByMe: comment.likedByMe, likes: comment.likes })));
        if (!r.ok) setNotice({ tone: "error", text: r.error });
      });
    },
    async report(comment, reason, note) {
      const r = handleResult(await reportCommentAction(comment.id, reason, note));
      if (!r.ok) return { ok: false, message: r.error };
      setThreads((t) => updateComment(t, comment.id, (c) => ({ ...c, reportedByMe: true, can: { ...c.can, report: false } })));
      return { ok: true, message: r.message ?? "Thanks. A moderator will review it." };
    },
    async source(comment) {
      const r = handleResult(await commentSourceAction(comment.id));
      return r.ok ? r.body : null;
    },
  };

  const sortButton = (value: CommentSort, label: string) => (
    <button
      type="button"
      aria-pressed={sort === value}
      onClick={() => changeSort(value)}
      className={`min-h-9 rounded-md px-3 text-sm font-semibold transition-colors ${sort === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return (
    <section id="comments" aria-labelledby="comments-title" className="mt-14 scroll-mt-24 border-t border-line pt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="comments-title" className="text-2xl font-bold tracking-tight text-fg">
          Discussion{total > 0 && <span className="ml-2 text-lg font-semibold text-fg-subtle">{total}</span>}
          <span className="sr-only">{total === 1 ? " comment" : " comments"}</span>
        </h2>
        {threads.length > 1 || nextCursor ? (
          <div role="group" aria-label="Sort comments" className="inline-flex rounded-lg bg-surface-sunken p-1">
            {sortButton("oldest", "Oldest")}
            {sortButton("newest", "Newest")}
          </div>
        ) : null}
      </div>

      <div className="mt-6 space-y-4">
        {state.locked && <Alert tone="info">This discussion is locked. Existing comments stay visible; new comments and replies are closed.</Alert>}
        {sessionEnded && (
          <Alert tone="info">
            Your session has ended.{" "}
            <a href={signInHref("comments")} className="font-semibold underline">
              Sign in again
            </a>{" "}
            to keep commenting.
          </Alert>
        )}
        {!state.locked &&
          !sessionEnded &&
          (sessionPending ? (
            <div className="skeleton h-28 rounded-xl" aria-hidden="true" />
          ) : session ? (
            <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
              <Composer
                label={`Comment as ${session.user.name}`}
                submitLabel="Post comment"
                siteKey={siteKey}
                verify
                onSubmit={(body, token, key) => post(body, token, key, null)}
              />
              {state.requireApproval && <p className="mt-3 text-xs text-fg-subtle">Comments from readers appear after a moderator approves them.</p>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:p-5">
              <p className="text-sm text-fg-muted">Join the discussion. Sign in to comment, reply and like.</p>
              <Link href={signInHref("comments")} className={buttonClass("primary", "md")}>
                Sign in to comment
              </Link>
            </div>
          ))}
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      </div>

      <div className="mt-8" aria-busy={status === "loading" || undefined}>
        {status === "loading" && threads.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-fg-subtle">
            <Spinner /> Loading comments…
          </p>
        )}
        {status === "error" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
            <p className="text-sm text-fg-muted">{error}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => load(sort)}>
              Retry
            </Button>
          </div>
        )}
        {status !== "error" && threads.length === 0 && status !== "loading" && (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-subtle">No comments yet. Start the discussion.</p>
        )}
        {threads.length > 0 && (
          <ol className={`space-y-8 ${status === "loading" ? "opacity-60" : ""}`} aria-label="Comments">
            {threads.map((c) => (
              <li key={c.id}>
                <CommentItem comment={c} level={0} path={path} siteKey={siteKey} formatTime={formatTime} highlight={highlight} signInHref={signInHref} signedIn={signedIn} handlers={handlers} />
              </li>
            ))}
          </ol>
        )}
        {nextCursor && status === "ready" && (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" loading={moreStatus === "loading"} onClick={loadMore}>
              {moreStatus === "loading" ? "Loading…" : "Load more comments"}
            </Button>
            {moreStatus === "error" && <span className="text-sm text-red-700 dark:text-red-300">Could not load more. Try again.</span>}
          </div>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
    </section>
  );
}
