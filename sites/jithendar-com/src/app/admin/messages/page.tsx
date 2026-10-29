import Link from "next/link";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, StatusPill } from "@/components/admin/ui";
import { Button } from "@/components/ui/form";
import { adminActor } from "@/lib/admin";
import { inbox, updateMessage } from "@/lib/contact";
import { formatDateTime } from "@/lib/dates";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Messages" };

async function act(form: FormData) {
  "use server";
  const actor = await adminActor();
  const back = `/admin/messages?status=${String(form.get("back") ?? "all")}`;
  await flash(back, async () => {
    await updateMessage(actor, String(form.get("id")), String(form.get("action")) as "read" | "new" | "archived" | "delete");
    return "Updated.";
  });
}

export default async function MessagesPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin");
  const sp = await searchParams;
  const status = (["new", "read", "archived", "all"] as const).find((s) => s === sp.status) ?? "all";
  const rows = await inbox(status);
  return (
    <>
      <AdminHeader title="Messages" description="Contact-form submissions, stored in the database." />
      <Flash ok={sp.ok} error={sp.error} />
      <nav aria-label="Filter messages" className="mb-6 flex flex-wrap gap-2">
        {(["all", "new", "read", "archived"] as const).map((s) => (
          <Link key={s} href={`/admin/messages?status=${s}`} aria-current={s === status ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${s === status ? "bg-fg text-canvas" : "border border-slate-200 dark:border-white/10"}`}>
            {s}
          </Link>
        ))}
      </nav>
      <div className="space-y-4">
        {rows.length === 0 && <p className="text-sm text-slate-500">No messages.</p>}
        {rows.map((m) => (
          <Card key={m.id}>
            <details open={m.status === "new"}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-fg">{m.subject}</span>
                <span className="flex items-center gap-2 text-sm text-slate-500"><StatusPill status={m.status} />{formatDateTime(m.createdAt.toISOString())}</span>
              </summary>
              <p className="mt-3 text-sm text-fg-muted">From {m.name} &lt;{m.email}&gt;</p>
              <p className="mt-3 whitespace-pre-line break-words text-slate-800 dark:text-slate-200">{m.message}</p>
              <form action={act} className="mt-4 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="back" value={status} />
                <a href={`mailto:${m.email}?subject=${encodeURIComponent("Re: " + m.subject)}`} className="inline-flex items-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent">Reply by email</a>
                {m.status === "new" && <Button type="submit" name="action" value="read" variant="secondary">Mark read</Button>}
                {m.status !== "new" && <Button type="submit" name="action" value="new" variant="secondary">Mark unread</Button>}
                {m.status !== "archived" && <Button type="submit" name="action" value="archived" variant="secondary">Archive</Button>}
                <Button type="submit" name="action" value="delete" variant="ghost">Delete</Button>
              </form>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
