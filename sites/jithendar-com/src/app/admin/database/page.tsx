import Link from "next/link";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, Stat, Table, td, th } from "@/components/admin/ui";
import { Button } from "@/components/ui/form";
import { adminActor } from "@/lib/admin";
import { browseTable, connectionInfo, MAINTENANCE, runMaintenance, tableStats } from "@/lib/db-admin";
import { flash } from "@/lib/flash";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Database" };
export const dynamic = "force-dynamic";

async function maintain(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/database", () => runMaintenance(actor, String(form.get("task"))));
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

export default async function DatabasePage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin");
  const sp = await searchParams;
  const [conn, tables] = await Promise.all([connectionInfo(), tableStats()]);
  const selected = sp.table && tables.some((t) => t.name === sp.table) ? sp.table : null;
  const browse = selected ? await browseTable(selected, Number(sp.page) || 1) : null;
  const totalBytes = tables.reduce((n, t) => n + t.bytes, 0);
  const pages = browse ? Math.max(1, Math.ceil(browse.total / browse.pageSize)) : 1;

  return (
    <>
      <AdminHeader
        title="Database"
        description="Connection, table sizes and maintenance. The browser is read-only; passwords, tokens and secret settings are always redacted."
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Round trip" value={`${conn.latencyMs} ms`} />
        <Stat label="Tables" value={tables.length} />
        <Stat label="Rows (est.)" value={tables.reduce((n, t) => n + t.rows, 0).toLocaleString()} />
        <Stat label="Size" value={`${(totalBytes / 1024 / 1024).toFixed(1)} MB`} />
      </div>

      <Card className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">Connection</h2>
        <p className="mb-4 font-mono text-xs text-slate-500">{conn.target}</p>
        <dl className="grid gap-4 sm:grid-cols-4">
          {Object.entries(conn.details).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wider text-slate-500">{k}</dt>
              <dd className="mt-1 text-sm text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          The connection string comes from the <code>DATABASE_URL</code> key of Secret <code>jithendar-com-env</code>. Change it there and redeploy; it cannot be changed from the browser, so a typo can never lock you out of the admin.
        </p>
      </Card>

      {browse ? (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-fg">
              <code>{browse.table}</code> <span className="text-sm font-normal text-slate-500">· {browse.total.toLocaleString()} rows · page {browse.page} of {pages}</span>
            </h2>
            <div className="flex gap-2 text-sm">
              {browse.page > 1 && <Link className="rounded-lg border border-line-strong px-3 py-1.5" href={`/admin/database?table=${browse.table}&page=${browse.page - 1}`}>← Previous</Link>}
              {browse.page < pages && <Link className="rounded-lg border border-line-strong px-3 py-1.5" href={`/admin/database?table=${browse.table}&page=${browse.page + 1}`}>Next →</Link>}
              <Link className="rounded-lg border border-line-strong px-3 py-1.5" href="/admin/database">Close</Link>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-xs">
              <thead>
                <tr>{browse.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-500">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {browse.rows.map((r, i) => (
                  <tr key={i}>
                    {browse.columns.map((c) => <td key={c} className="max-w-xs truncate whitespace-nowrap px-3 py-2 font-mono text-fg-muted" title={cell(r[c])}>{cell(r[c])}</td>)}
                  </tr>
                ))}
                {browse.rows.length === 0 && <tr><td className="px-3 py-6 text-slate-500" colSpan={browse.columns.length}>No rows.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Table head={<tr><th className={th}>Table</th><th className={th}>Rows (est.)</th><th className={th}>Size</th><th className={th}>Last vacuum</th><th className={th}>Last analyze</th><th className={th} /></tr>}>
        {tables.map((t) => (
          <tr key={t.name}>
            <td className={`${td} font-mono`}>{t.name}</td>
            <td className={td}>{t.rows.toLocaleString()}</td>
            <td className={td}>{t.size}</td>
            <td className={`${td} text-xs`}>{t.lastVacuum?.slice(0, 16) ?? "—"}</td>
            <td className={`${td} text-xs`}>{t.lastAnalyze?.slice(0, 16) ?? "—"}</td>
            <td className={`${td} text-right`}><Link className="font-semibold text-brand-600 hover:underline dark:text-brand-300" href={`/admin/database?table=${t.name}`}>Browse</Link></td>
          </tr>
        ))}
      </Table>

      <Card className="mt-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">Maintenance</h2>
        <p className="mb-4 text-sm text-slate-500">Safe housekeeping. Each run is recorded in the audit log. Postgres also autovacuums on its own.</p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(MAINTENANCE).map(([task, label]) => (
            <form key={task} action={maintain}>
              <input type="hidden" name="task" value={task} />
              <Button type="submit" variant="secondary">{label}</Button>
            </form>
          ))}
        </div>
      </Card>
    </>
  );
}
