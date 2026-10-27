import { desc, ilike, or } from "drizzle-orm";
import { AdminHeader, Table, td, th } from "@/components/admin/ui";
import { Input } from "@/components/ui/form";
import { getDb, schema } from "@/db";
import { formatDateTime } from "@/lib/dates";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole("admin");
  const { q = "" } = await searchParams;
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(q ? or(ilike(schema.auditLog.action, `%${q}%`), ilike(schema.auditLog.actor, `%${q}%`), ilike(schema.auditLog.target, `%${q}%`)) : undefined)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(300);
  return (
    <>
      <AdminHeader title="Audit log" description="Every change made from the admin or the API (most recent 300)." />
      <form className="mb-6 max-w-md"><Input name="q" defaultValue={q} placeholder="Filter by action, actor or target" aria-label="Filter audit log" /></form>
      <Table head={<tr><th className={th}>When</th><th className={th}>Actor</th><th className={th}>Action</th><th className={th}>Target</th><th className={th}>Details</th></tr>}>
        {rows.length === 0 && <tr><td className={td} colSpan={5}>No entries.</td></tr>}
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={`${td} whitespace-nowrap`}>{formatDateTime(r.createdAt.toISOString())}</td>
            <td className={td}>{r.actor}</td>
            <td className={`${td} font-mono text-xs`}>{r.action}</td>
            <td className={`${td} max-w-xs truncate`} title={r.target ?? ""}>{r.target}</td>
            <td className={`${td} max-w-sm truncate font-mono text-xs`} title={r.detail ? JSON.stringify(r.detail) : ""}>{r.detail ? JSON.stringify(r.detail) : ""}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
