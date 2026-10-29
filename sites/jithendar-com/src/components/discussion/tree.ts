import type { CommentView } from "@/lib/comment-types";

/** Apply `fn` to the comment with this id, wherever it is in the threads. */
export function updateComment(threads: CommentView[], id: string, fn: (c: CommentView) => CommentView): CommentView[] {
  let changed = false;
  const walk = (list: CommentView[]): CommentView[] =>
    list.map((c) => {
      if (c.id === id) {
        changed = true;
        return fn(c);
      }
      if (c.replies.length === 0) return c;
      const replies = walk(c.replies);
      return replies === c.replies ? c : { ...c, replies };
    });
  const next = walk(threads);
  return changed ? next : threads;
}

/** Replace a thread (matched by its top-level id) or add it: first for newest-first, last otherwise. */
export function upsertThread(threads: CommentView[], thread: CommentView, sort: "oldest" | "newest"): CommentView[] {
  const i = threads.findIndex((t) => t.id === thread.id);
  if (i >= 0) return threads.map((t, k) => (k === i ? thread : t));
  return sort === "newest" ? [thread, ...threads] : [...threads, thread];
}

/** Append a page, skipping threads already shown (e.g. one just posted or opened from a permalink). */
export function appendPage(threads: CommentView[], page: CommentView[]): CommentView[] {
  const seen = new Set(threads.map((t) => t.id));
  return [...threads, ...page.filter((t) => !seen.has(t.id))];
}

export function containsComment(threads: CommentView[], id: string): boolean {
  return threads.some((c) => c.id === id || containsComment(c.replies, id));
}

/** "comment-<uuid>" from a URL hash, or null. */
export function commentIdFromHash(hash: string): string | null {
  const m = /^#comment-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash);
  return m ? m[1]!.toLowerCase() : null;
}
