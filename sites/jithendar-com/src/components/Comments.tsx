import { approvedComments } from "@/lib/comments";
import { formatDateTime } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { turnstileSiteKey } from "@/lib/turnstile";
import { Avatar } from "./AuthorCard";
import { CommentForm } from "./CommentForm";

/** Approved comments (plain text, never rendered as HTML) and the comment form. */
export async function Comments({ postId, path }: { postId: string; path: string }) {
  if (!(await getSettings()).features.comments) return null;
  const comments = await approvedComments(postId);
  return (
    <section id="comments" aria-labelledby="comments-title" className="mt-14 scroll-mt-24 border-t border-line pt-10">
      <h2 id="comments-title" className="text-2xl font-bold tracking-tight text-fg">
        {comments.length > 0 ? `Comments (${comments.length})` : "Comments"}
      </h2>
      <ol className="mt-6 space-y-6">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-4">
            <Avatar name={c.author} size="sm" />
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-semibold text-fg">{c.author}</span>{" "}
                <time dateTime={c.createdAt.toISOString()} className="text-slate-500">{formatDateTime(c.createdAt.toISOString())}</time>
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-fg-muted">{c.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {comments.length === 0 && <p className="mt-2 text-sm text-slate-500">No comments yet. Start the conversation.</p>}
      <div className="mt-8">
        <CommentForm postId={postId} path={path} siteKey={turnstileSiteKey()} />
      </div>
    </section>
  );
}
