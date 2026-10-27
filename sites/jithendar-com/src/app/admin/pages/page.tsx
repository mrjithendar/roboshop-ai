import { asc } from "drizzle-orm";
import Link from "next/link";
import { AdminHeader, Table, td, th } from "@/components/admin/ui";
import { getDb, schema } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Pages" };

export default async function PagesPage() {
  await requireRole("admin", "author");
  const db = await getDb();
  const pages = await db.select().from(schema.page).orderBy(asc(schema.page.title));
  return (
    <>
      <AdminHeader
        title="Pages"
        description="About, contact, policies and other standalone pages."
        actions={<Link href="/admin/pages/new" className="inline-flex items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-ink">New page</Link>}
      />
      <Table head={<tr><th className={th}>Page</th><th className={th}>URL</th><th className={th}>Last saved</th><th className={th} /></tr>}>
        {pages.length === 0 && (
          <tr>
            <td className={td} colSpan={4}>No pages yet. Run /setup to import the bundled pages, or create one.</td>
          </tr>
        )}
        {pages.map((p) => (
          <tr key={p.slug}>
            <td className={td}>
              <Link href={`/admin/pages/${p.slug}`} className="font-medium text-ink hover:underline dark:text-white">{p.title}</Link>
            </td>
            <td className={`${td} font-mono text-xs`}>/{p.slug}</td>
            <td className={`${td} whitespace-nowrap`}>{formatDateTime(p.savedAt.toISOString())}</td>
            <td className={td}>
              <Link href={`/${p.slug}`} target="_blank" className="text-sm underline">View ↗</Link>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
