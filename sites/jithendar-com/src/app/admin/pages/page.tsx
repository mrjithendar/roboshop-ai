import { asc, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";
import { AdminHeader, Table, td, th } from "@/components/admin/ui";
import { getDb, schema } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { requireRole } from "@/lib/session";
import { bundledPages } from "@/lib/site-pages";
import { PageRowActions } from "./PageRowActions";

export const metadata = { title: "Pages" };

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  await requireRole("admin", "author");
  const { q = "", view = "" } = await searchParams;
  const trash = view === "trash";
  const db = await getDb();
  const all = await db.select().from(schema.page).where(trash ? isNotNull(schema.page.deletedAt) : isNull(schema.page.deletedAt)).orderBy(asc(schema.page.sortOrder), asc(schema.page.title));
  const needle = q.trim().toLowerCase();
  const pages = needle ? all.filter((p) => `${p.title} ${p.slug}`.toLowerCase().includes(needle)) : all;
  const existing = new Set((await db.select({ slug: schema.page.slug }).from(schema.page)).map((p) => p.slug));
  const missing = [...(await bundledPages()).values()].filter((p) => !existing.has(p.slug));
  return (
    <>
      <AdminHeader
        title="Pages"
        description="About, contact, policies and other standalone pages."
        actions={<Link href="/admin/pages/new" className="inline-flex items-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent">New page</Link>}
      />
      {missing.length > 0 && !trash && (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
          Drafts shipped with the site, not yet added:{" "}
          {missing.map((p, i) => (
            <span key={p.slug}>
              {i > 0 && ", "}
              <Link href={`/admin/pages/new?from=${p.slug}`} className="font-semibold underline">{p.title}</Link>
            </span>
          ))}
          . Opening one loads it into the editor for review; nothing is published until you save.
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="View" className="flex gap-1 text-sm">
          <Link href="/admin/pages" aria-current={!trash ? "page" : undefined} className={`rounded-full px-3 py-1.5 font-medium ${!trash ? "bg-accent text-on-accent" : "text-fg-muted"}`}>Pages</Link>
          <Link href="/admin/pages?view=trash" aria-current={trash ? "page" : undefined} className={`rounded-full px-3 py-1.5 font-medium ${trash ? "bg-accent text-on-accent" : "text-fg-muted"}`}>Trash</Link>
        </nav>
        <form className="ml-auto flex gap-2">
          {trash && <input type="hidden" name="view" value="trash" />}
          <input name="q" defaultValue={q} placeholder="Search pages" aria-label="Search pages" className="min-h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm" />
        </form>
      </div>
      <Table head={<tr><th className={th}>Page</th><th className={th}>URL</th><th className={th}>Order</th><th className={th}>{trash ? "Trashed" : "Last saved"}</th></tr>}>
        {pages.length === 0 && (
          <tr><td className={td} colSpan={4}>{trash ? "The trash is empty." : "No pages match."}</td></tr>
        )}
        {pages.map((p) => (
          <tr key={p.slug}>
            <td className={`${td} min-w-48`}>
              {trash ? <span className="font-medium">{p.title}</span> : <Link href={`/admin/pages/${p.slug}`} className="font-medium text-fg hover:underline">{p.title}</Link>}
              <PageRowActions slug={p.slug} trash={trash} />
            </td>
            <td className={`${td} font-mono text-xs`}>/{p.slug}</td>
            <td className={td}>{p.sortOrder}</td>
            <td className={`${td} whitespace-nowrap`}>{formatDateTime((p.deletedAt ?? p.savedAt).toISOString())}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
