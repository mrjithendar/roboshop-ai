import Link from "next/link";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, StatusPill, Table, td, th } from "@/components/admin/ui";
import { Button, Input, Select } from "@/components/ui/form";
import { staffActor } from "@/lib/admin";
import {
  DISCUSSION_MODES,
  discussionsOverview,
  MODERATION_ACTIONS,
  MODERATION_FILTERS,
  moderateComment,
  moderationCounts,
  moderationQueue,
  reportReasonLabels,
  setDiscussionMode,
  type DiscussionMode,
  type ModerationAction,
  type ModerationFilter,
  type QueueItem,
  type ReportReason,
} from "@/lib/comments";
import { formatDateTime } from "@/lib/dates";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Comments" };

const TABS = [...MODERATION_FILTERS, "discussions"] as const;
type Tab = (typeof TABS)[number];
const tabLabels: Record<Tab, string> = { pending: "Pending", reported: "Reported", approved: "Approved", hidden: "Hidden", removed: "Removed", all: "All", discussions: "Discussions" };

const DONE: Record<ModerationAction, string> = {
  approve: "Comment approved.",
  restore: "Comment restored.",
  hide: "Comment hidden.",
  remove: "Comment removed.",
  dismiss: "Reports dismissed.",
  purge: "Comment deleted permanently.",
};

async function moderate(form: FormData) {
  "use server";
  const actor = await staffActor();
  const back = `/admin/comments?status=${encodeURIComponent(String(form.get("back") ?? "pending"))}`;
  await flash(back, async () => {
    const action = String(form.get("action")) as ModerationAction;
    await moderateComment(actor, String(form.get("id")), action, String(form.get("note") ?? ""));
    return DONE[action] ?? "Done.";
  });
}

async function changeDiscussion(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/comments?status=discussions", async () => {
    const mode = String(form.get("mode")) as DiscussionMode;
    await setDiscussionMode(actor, String(form.get("postId")), mode);
    return mode === "open" ? "Discussion opened." : mode === "locked" ? "Discussion locked." : "Discussion closed.";
  });
}

/** What each status can become, in button order (purge is admin-only and only without replies). */
function actionsFor(item: QueueItem, admin: boolean): ModerationAction[] {
  if (item.deletedAt) return item.reports.length ? ["dismiss"] : [];
  const list: ModerationAction[] = [];
  if (item.status === "pending") list.push("approve");
  if (item.status === "approved" && item.reports.length) list.push("dismiss");
  if (["hidden", "removed", "rejected", "spam"].includes(item.status)) list.push("restore");
  if (item.status !== "hidden") list.push("hide");
  if (!["removed", "rejected", "spam"].includes(item.status)) list.push("remove");
  if (admin && !item.hasReplies) list.push("purge");
  return list.filter((a) => MODERATION_ACTIONS.includes(a));
}

const actionLabels: Record<ModerationAction, string> = { approve: "Approve", restore: "Restore", hide: "Hide", remove: "Remove", dismiss: "Dismiss reports", purge: "Delete permanently" };

export default async function CommentsPage({ searchParams }: { searchParams: FlashParams }) {
  const user = await requireRole("admin", "author");
  const actor = { id: user.id, role: user.role, label: user.email };
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as Tab) : "pending";
  const [counts, settings] = await Promise.all([moderationCounts(), getSettings()]);
  const isAdmin = user.role === "admin";

  return (
    <>
      <AdminHeader
        title="Comments"
        description="Review new and reported comments, and open, lock or close the discussion on each post. Every decision is recorded in the audit log. Comment text is shown here as plain text."
      />
      <Flash ok={sp.ok} error={sp.error} />

      <Card className="mb-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-fg-subtle">Comments</dt>
            <dd className="mt-1 font-semibold text-fg">{settings.features.comments ? "On for all posts" : "Off site-wide"}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">New reader comments</dt>
            <dd className="mt-1 font-semibold text-fg">{settings.discussion.requireApproval ? "Need approval" : "Published at once"}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Readers can edit for</dt>
            <dd className="mt-1 font-semibold text-fg">{settings.discussion.editWindowMinutes === 0 ? "No time limit" : `${settings.discussion.editWindowMinutes} minutes`}</dd>
          </div>
        </dl>
        {isAdmin && (
          <p className="mt-4 text-sm text-fg-muted">
            Change these in{" "}
            <Link href="/admin/appearance?section=general" className="link">
              Appearance &amp; settings → General → Features
            </Link>{" "}
            (applies when published).
          </p>
        )}
      </Card>

      <nav aria-label="Filter comments" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((s) => {
          const badge = s === "pending" ? counts.pending : s === "reported" ? counts.reported : 0;
          return (
            <Link
              key={s}
              href={`/admin/comments?status=${s}`}
              aria-current={s === tab ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${s === tab ? "bg-fg text-canvas" : "border border-line text-fg-muted hover:text-fg"}`}
            >
              {tabLabels[s]}
              {badge > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent">
                  {badge}
                  <span className="sr-only"> need attention</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {tab === "discussions" ? <Discussions actor={actor} q={sp.q ?? ""} /> : <Queue actor={actor} filter={tab} isAdmin={isAdmin} />}
    </>
  );
}

async function Queue({ actor, filter, isAdmin }: { actor: Parameters<typeof moderationQueue>[0]; filter: ModerationFilter; isAdmin: boolean }) {
  const rows = await moderationQueue(actor, filter);
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-subtle">Nothing here.</p>;
  return (
    <div className="space-y-4">
      {rows.map((c) => {
        const actions = actionsFor(c, isAdmin);
        return (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-semibold text-fg">{c.author}</span>
                {c.email && <span className="text-fg-subtle"> ({c.email})</span>} {c.isReply ? "replied on" : "on"}{" "}
                <Link href={`/${c.post.collection}/${c.post.slug}#comment-${c.id}`} target="_blank" className="link">
                  {c.post.title}
                </Link>
              </p>
              <span className="flex flex-wrap items-center gap-2 text-fg-subtle">
                <StatusPill status={c.deletedAt ? "deleted" : c.status} />
                {c.reports.length > 0 && <StatusPill status="reported" />}
                <time dateTime={c.createdAt.toISOString()}>{formatDateTime(c.createdAt.toISOString())}</time>
              </span>
            </div>
            {c.deletedAt ? (
              <p className="mt-3 text-sm italic text-fg-subtle">Deleted by its author{c.hasReplies ? "; shown to readers as a placeholder because it has replies" : ""}.</p>
            ) : (
              <p className="mt-3 whitespace-pre-line break-words text-fg-muted">{c.body}</p>
            )}
            {c.editedAt && <p className="mt-2 text-xs text-fg-subtle">Edited {formatDateTime(c.editedAt.toISOString())}</p>}
            {c.reports.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm dark:border-red-500/30 dark:bg-red-500/5">
                <p className="font-semibold text-fg">
                  {c.reports.length} open {c.reports.length === 1 ? "report" : "reports"}
                </p>
                <ul className="mt-2 space-y-1.5 text-fg-muted">
                  {c.reports.map((r, i) => (
                    <li key={i}>
                      {reportReasonLabels[r.reason as ReportReason] ?? r.reason}
                      {r.note && <span className="text-fg-subtle"> — “{r.note}”</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {actions.length > 0 && (
              <form action={moderate} className="mt-4 space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="back" value={filter} />
                <label className="block max-w-md">
                  <span className="sr-only">Moderation note</span>
                  <Input name="note" maxLength={500} placeholder="Note for the audit log (optional)" className="min-h-9 text-sm" />
                </label>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <Button key={a} type="submit" name="action" value={a} size="sm" variant={a === "approve" || a === "restore" ? "primary" : a === "purge" ? "ghost" : "secondary"}>
                      {actionLabels[a]}
                    </Button>
                  ))}
                </div>
              </form>
            )}
          </Card>
        );
      })}
    </div>
  );
}

async function Discussions({ actor, q }: { actor: Parameters<typeof discussionsOverview>[0]; q: string }) {
  const posts = await discussionsOverview(actor, q);
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm leading-6 text-fg-muted">
        <strong className="font-semibold text-fg">Open</strong>: readers can comment. <strong className="font-semibold text-fg">Locked</strong>: comments stay visible; no new comments, replies, edits or likes.{" "}
        <strong className="font-semibold text-fg">Closed</strong>: the discussion is not shown. {actor.role === "author" ? "You can change your own posts." : ""}
      </p>
      <form className="mb-4 flex max-w-md gap-2">
        <input type="hidden" name="status" value="discussions" />
        <Input name="q" defaultValue={q} placeholder="Find a post by title" aria-label="Find a post by title" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <Table
        head={
          <tr>
            <th className={th}>Post</th>
            <th className={th}>Comments</th>
            <th className={th}>Discussion</th>
          </tr>
        }
      >
        {posts.length === 0 && (
          <tr>
            <td className={td} colSpan={3}>
              No published posts.
            </td>
          </tr>
        )}
        {posts.map((p) => (
          <tr key={p.id}>
            <td className={`${td} min-w-56`}>
              <Link href={`/${p.collection}/${p.slug}#comments`} target="_blank" className="font-medium text-fg hover:underline">
                {p.title}
              </Link>
            </td>
            <td className={`${td} tabular-nums`}>{Number(p.comments)}</td>
            <td className={td}>
              <form action={changeDiscussion} className="flex items-center gap-2">
                <input type="hidden" name="postId" value={p.id} />
                <StatusPill status={p.discussion} />
                <Select name="mode" defaultValue={p.discussion} aria-label={`Discussion on ${p.title}`} className="min-h-9 w-auto text-sm">
                  {DISCUSSION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m[0]!.toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" variant="secondary">
                  Save
                </Button>
              </form>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
