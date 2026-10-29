import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, StatusPill, Table, td, th } from "@/components/admin/ui";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { adminActor } from "@/lib/admin";
import { backupSummary, recentRuns, runBackup, saveDestination, saveGeneral, testDestination } from "@/lib/backups";
import { formatDateTime } from "@/lib/dates";
import { flash } from "@/lib/flash";
import { PostError } from "@/lib/posts";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Backups" };

async function general(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/backups", async () => {
    await saveGeneral(actor, Object.fromEntries(form));
    return "Backup settings saved.";
  });
}

async function destination(form: FormData) {
  "use server";
  const actor = await adminActor();
  const kind = String(form.get("kind")) as "s3" | "sftp" | "gdrive";
  await flash("/admin/backups", async () => {
    const fields: Record<string, string | boolean> = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    fields.enabled = form.has("enabled");
    fields.forcePathStyle = form.has("forcePathStyle");
    await saveDestination(actor, kind, fields);
    if (form.get("test") === "1") await testDestination(actor, kind);
    return form.get("test") === "1" ? `${kind.toUpperCase()} saved and tested successfully.` : `${kind.toUpperCase()} saved.`;
  });
}

async function runNow() {
  "use server";
  const actor = await adminActor();
  await flash("/admin/backups", async () => {
    const r = await runBackup("manual", actor);
    if (r.status === "failed") throw new PostError(`Backup failed: ${r.results.map((x) => x.detail).join("; ")}`);
    return `Backup ${r.status}: ${r.results.map((x) => `${x.destination} ${x.ok ? "✓" : "✗ " + x.detail}`).join(", ")}`;
  });
}

const Enabled = ({ on }: { on?: boolean }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={on ?? true} /> Use this destination</label>
);
const SaveButtons = () => (
  <div className="flex gap-2 sm:col-span-2">
    <Button type="submit" name="test" value="0" variant="secondary">Save</Button>
    <Button type="submit" name="test" value="1">Save and test</Button>
  </div>
);

export default async function BackupsPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin");
  const [b, runs, sp] = await Promise.all([backupSummary(), recentRuns(), searchParams]);
  return (
    <>
      <AdminHeader
        title="Backups"
        description="Encrypted backups of content and configuration. Excludes password hashes, sessions, API-key hashes and stored credentials."
        actions={
          <>
            <form action={runNow}><Button type="submit">Back up now</Button></form>
            <a href="/api/admin/backup" download className="inline-flex items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold">Download backup</a>
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="space-y-6">
        <Card>
          <h2 className="mb-4 font-semibold text-fg">Schedule and encryption</h2>
          <form action={general} className="grid gap-4 sm:grid-cols-4">
            <Field label="Schedule" htmlFor="schedule">
              <Select id="schedule" name="schedule" defaultValue={b.schedule}><option value="off">Off (manual only)</option><option value="daily">Daily</option><option value="weekly">Weekly</option></Select>
            </Field>
            <Field label="Hour (UTC)" htmlFor="hourUtc" hint="21 UTC = 02:30 IST"><Input id="hourUtc" name="hourUtc" type="number" min={0} max={23} defaultValue={b.hourUtc} /></Field>
            <Field label="Keep last" htmlFor="retention" hint="Older backups are deleted."><Input id="retention" name="retention" type="number" min={1} max={365} defaultValue={b.retention} /></Field>
            <Field label="Backup passphrase" htmlFor="passphrase" hint={b.hasPassphrase ? "Set. Leave empty to keep it." : "Required, 12+ characters. Store it safely: without it backups cannot be restored."}>
              <Input id="passphrase" name="passphrase" type="password" autoComplete="new-password" />
            </Field>
            <div className="sm:col-span-4"><Button type="submit">Save</Button></div>
          </form>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-fg">Amazon S3 / S3-compatible</h2><StatusPill status={b.s3?.enabled ? "ok" : b.s3 ? "read" : "not configured"} /></div>
          <form action={destination} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="kind" value="s3" />
            <Field label="Endpoint (empty for AWS)" htmlFor="b-endpoint"><Input id="b-endpoint" name="endpoint" defaultValue={b.s3?.endpoint ?? ""} /></Field>
            <Field label="Region" htmlFor="b-region"><Input id="b-region" name="region" defaultValue={b.s3?.region ?? "us-east-1"} /></Field>
            <Field label="Bucket" htmlFor="b-bucket"><Input id="b-bucket" name="bucket" defaultValue={b.s3?.bucket ?? ""} /></Field>
            <Field label="Folder" htmlFor="b-prefix"><Input id="b-prefix" name="prefix" defaultValue={b.s3?.prefix ?? "backups"} /></Field>
            <Field label="Access key ID" htmlFor="b-key"><Input id="b-key" name="accessKeyId" defaultValue={b.s3?.accessKeyId ?? ""} autoComplete="off" /></Field>
            <Field label="Secret access key" htmlFor="b-secret" hint={b.s3 ? "Leave empty to keep." : undefined}><Input id="b-secret" name="secret" type="password" autoComplete="off" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="forcePathStyle" defaultChecked={b.s3?.forcePathStyle ?? false} /> Path-style URLs</label>
            <Enabled on={b.s3?.enabled} />
            <SaveButtons />
          </form>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-fg">SFTP</h2><StatusPill status={b.sftp?.enabled ? "ok" : b.sftp ? "read" : "not configured"} /></div>
          <form action={destination} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="kind" value="sftp" />
            <Field label="Host" htmlFor="s-host"><Input id="s-host" name="host" defaultValue={b.sftp?.host ?? ""} /></Field>
            <Field label="Port" htmlFor="s-port"><Input id="s-port" name="port" type="number" defaultValue={b.sftp?.port ?? 22} /></Field>
            <Field label="Username" htmlFor="s-user"><Input id="s-user" name="username" defaultValue={b.sftp?.username ?? ""} autoComplete="off" /></Field>
            <Field label="Remote folder" htmlFor="s-path"><Input id="s-path" name="path" defaultValue={b.sftp?.path ?? "backups"} /></Field>
            <Field label="Password" htmlFor="s-pass" hint={b.sftp ? "Leave empty to keep." : "Or use a private key."}><Input id="s-pass" name="password" type="password" autoComplete="off" /></Field>
            <Field label="Private key (OpenSSH PEM)" htmlFor="s-key" hint={b.sftp?.auth === "key" ? "Set. Leave empty to keep." : undefined}><Textarea id="s-key" name="privateKey" rows={2} className="font-mono text-xs" /></Field>
            <Enabled on={b.sftp?.enabled} />
            <SaveButtons />
          </form>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-fg">Google Drive</h2><StatusPill status={b.gdrive?.enabled ? "ok" : b.gdrive ? "read" : "not configured"} /></div>
          <form action={destination} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="kind" value="gdrive" />
            <Field label="Folder ID" htmlFor="g-folder" hint="From the folder URL: drive.google.com/drive/folders/<ID>"><Input id="g-folder" name="folderId" defaultValue={b.gdrive?.folderId ?? ""} /></Field>
            <Field label="Credentials JSON" htmlFor="g-cred" hint={'Service account (for a Shared Drive, add it as a member) or an "authorized_user" JSON with a refresh token (for a personal Drive). Leave empty to keep.'}>
              <Textarea id="g-cred" name="credentials" rows={3} className="font-mono text-xs" />
            </Field>
            <Enabled on={b.gdrive?.enabled} />
            <SaveButtons />
          </form>
        </Card>

        <div>
          <h2 className="mb-3 font-semibold text-fg">Recent runs</h2>
          <Table head={<tr><th className={th}>Started</th><th className={th}>Trigger</th><th className={th}>Status</th><th className={th}>File</th><th className={th}>Destinations</th></tr>}>
            {runs.length === 0 && <tr><td className={td} colSpan={5}>No backups yet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(r.startedAt.toISOString())}</td>
                <td className={td}>{r.trigger}</td>
                <td className={td}><StatusPill status={r.status === "success" ? "ok" : r.status === "partial" ? "degraded" : r.status === "running" ? "pending" : "down"} /></td>
                <td className={`${td} font-mono text-xs`}>{r.filename ?? "—"}{r.sizeBytes ? ` (${Math.round(r.sizeBytes / 1024)} KB)` : ""}</td>
                <td className={`${td} text-xs`}>{r.results.map((x) => `${x.destination}: ${x.ok ? "ok" : x.detail}`).join(" · ")}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </>
  );
}
