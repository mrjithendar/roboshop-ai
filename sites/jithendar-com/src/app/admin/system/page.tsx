import Link from "next/link";
import { AdminHeader, Card, StatusPill, Table, td, th } from "@/components/admin/ui";
import { systemChecks } from "@/lib/health";
import { requireRole } from "@/lib/session";

export const metadata = { title: "System status" };
export const dynamic = "force-dynamic";

export default async function SystemPage() {
  await requireRole("admin");
  const { app, checks } = await systemChecks();
  const down = checks.filter((c) => c.status === "down").length;
  return (
    <>
      <AdminHeader
        title="System status"
        description={down ? `${down} dependency check(s) failing.` : "Live checks of every service the site depends on. Reload to re-run."}
        actions={<Link href="/admin/system" prefetch={false} className="inline-flex items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold">Re-run checks</Link>}
      />
      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-5">
          {Object.entries(app).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wider text-slate-500">{k}</dt>
              <dd className="mt-1 font-mono text-sm text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Table head={<tr><th className={th}>Service</th><th className={th}>Status</th><th className={th}>Response</th><th className={th}>Details</th></tr>}>
        {checks.map((c) => (
          <tr key={c.name}>
            <td className={`${td} font-medium text-fg`}>{c.name}</td>
            <td className={td}><StatusPill status={c.status} /></td>
            <td className={`${td} font-mono text-xs`}>{c.ms === null ? "—" : `${c.ms} ms`}</td>
            <td className={`${td} text-sm`}>{c.detail}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
