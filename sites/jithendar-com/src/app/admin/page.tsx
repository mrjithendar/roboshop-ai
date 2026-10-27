import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { AdminHeader, Card, Stat } from "@/components/admin/ui";
import { getDb, schema } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { postCounts } from "@/lib/posts";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const user = await requireRole("admin", "author");
  const db = await getDb();
  const [counts, [pending], [unread], [users], recent] = await Promise.all([
    postCounts(),
    db.select({ n: count() }).from(schema.comment).where(eq(schema.comment.status, "pending")),
    db.select({ n: count() }).from(schema.contactMessage).where(eq(schema.contactMessage.status, "new")),
    db.select({ n: count() }).from(schema.user),
    user.role === "admin" ? db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(10) : Promise.resolve([]),
  ]);
  return (
    <>
      <AdminHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description="What needs attention across the publication."
        actions={
          <Link href="/admin/posts/new" className="inline-flex items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-ink">
            New post
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Published" value={counts.published ?? 0} />
        <Stat label="In review" value={counts.review ?? 0} hint={<Link href="/admin/posts?status=review" className="underline">Review queue</Link>} />
        <Stat label="Drafts" value={counts.draft ?? 0} />
        <Stat label="Pending comments" value={pending?.n ?? 0} hint={<Link href="/admin/comments" className="underline">Moderate</Link>} />
        {user.role === "admin" && <Stat label="New messages" value={unread?.n ?? 0} hint={<Link href="/admin/messages" className="underline">Inbox</Link>} />}
        {user.role === "admin" && <Stat label="Accounts" value={users?.n ?? 0} />}
      </div>
      {recent.length > 0 && (
        <Card className="mt-8">
          <h2 className="font-semibold text-ink dark:text-white">Recent activity</h2>
          <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-white/5">
            {recent.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                <span>
                  <span className="font-mono text-xs text-brand-700 dark:text-brand-300">{e.action}</span>{" "}
                  <span className="text-slate-600 dark:text-slate-300">{e.target}</span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {e.actor} · {formatDateTime(e.createdAt.toISOString())}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
