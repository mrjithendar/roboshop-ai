import Link from "next/link";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, StatusPill } from "@/components/admin/ui";
import { Button } from "@/components/ui/form";
import { staffActor } from "@/lib/admin";
import { moderateComment, moderationQueue, MODERATION, type ModerationStatus } from "@/lib/comments";
import { formatDateTime } from "@/lib/dates";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Comments" };

async function moderate(form: FormData) {
  "use server";
  const actor = await staffActor();
  const back = `/admin/comments?status=${String(form.get("back") ?? "pending")}`;
  await flash(back, async () => {
    const action = String(form.get("action")) as ModerationStatus | "delete";
    await moderateComment(actor, String(form.get("id")), action);
    return action === "delete" ? "Comment deleted." : `Comment marked ${action}.`;
  });
}

export default async function CommentsPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin", "author");
  const sp = await searchParams;
  const status = (MODERATION as readonly string[]).includes(sp.status ?? "") || sp.status === "all" ? (sp.status as ModerationStatus | "all") : "pending";
  const rows = await moderationQueue(status);
  return (
    <>
      <AdminHeader title="Comments" description="Readers' comments appear after you approve them. Comment text is shown as plain text only." />
      <Flash ok={sp.ok} error={sp.error} />
      <nav aria-label="Filter comments" className="mb-6 flex flex-wrap gap-2">
        {(["pending", "approved", "rejected", "spam", "all"] as const).map((s) => (
          <Link key={s} href={`/admin/comments?status=${s}`} aria-current={s === status ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${s === status ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-slate-200 dark:border-white/10"}`}>
            {s}
          </Link>
        ))}
      </nav>
      <div className="space-y-4">
        {rows.length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
        {rows.map(({ comment: c, author, email, post, collection, slug }) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>
                <span className="font-semibold text-ink dark:text-white">{author}</span> <span className="text-slate-500">({email})</span> on{" "}
                <Link href={`/${collection}/${slug}#comments`} target="_blank" className="underline">{post}</Link>
              </p>
              <span className="flex items-center gap-2 text-slate-500"><StatusPill status={c.status} />{formatDateTime(c.createdAt.toISOString())}</span>
            </div>
            <p className="mt-3 whitespace-pre-line break-words text-slate-700 dark:text-slate-300">{c.body}</p>
            <form action={moderate} className="mt-4 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="back" value={status} />
              {c.status !== "approved" && <Button type="submit" name="action" value="approved">Approve</Button>}
              {c.status !== "rejected" && <Button type="submit" name="action" value="rejected" variant="secondary">Reject</Button>}
              {c.status !== "spam" && <Button type="submit" name="action" value="spam" variant="secondary">Spam</Button>}
              <Button type="submit" name="action" value="delete" variant="ghost">Delete</Button>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
