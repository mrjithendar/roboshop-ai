import Link from "next/link";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, StatusPill, Table, td, th } from "@/components/admin/ui";
import { Alert, Button, Field, Input } from "@/components/ui/form";
import { adminActor, actorOf } from "@/lib/admin";
import { flash } from "@/lib/flash";
import { emailSummary, saveEmailConfig } from "@/lib/mail";
import { migrateBatch, migrationStatus, rollbackMigration } from "@/lib/media-migration";
import { PostError } from "@/lib/posts";
import { requireRole } from "@/lib/session";
import { MEDIA_ROOT, saveStorageConfig, storageSummary } from "@/lib/storage";

export const metadata = { title: "Storage & email" };

async function saveStorage(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/storage", async () => {
    const r = await saveStorageConfig(actor, {
      accountId: String(form.get("accountId") ?? ""),
      endpoint: String(form.get("endpoint") ?? ""),
      bucket: String(form.get("bucket") ?? ""),
      publicBaseUrl: String(form.get("publicBaseUrl") ?? ""),
      accessKeyId: String(form.get("accessKeyId") ?? ""),
      secretAccessKey: String(form.get("secretAccessKey") ?? ""),
    });
    if (!r.verified) throw new PostError(`Saved, but the connection test failed, so uploads stay disabled: ${r.error}`);
    return "Cloudflare R2 connected. Uploads are enabled.";
  });
}

async function migrate() {
  "use server";
  const actor = await adminActor();
  await flash("/admin/storage", async () => {
    const { entries, remaining } = await migrateBatch(actor, { dryRun: false, limit: 25 });
    const failed = entries.filter((e) => e.status.startsWith("failed"));
    if (failed.length) throw new PostError(`${entries.length - failed.length} copied, ${failed.length} failed (${failed[0]!.status}). ${remaining} still on S3. Run again to retry.`);
    return `${entries.length} file(s) copied to R2 and verified. ${remaining} still on S3.`;
  });
}

async function rollback() {
  "use server";
  const actor = await adminActor();
  await flash("/admin/storage", async () => `${await rollbackMigration(actor)} file(s) now read from the legacy S3 bucket again.`);
}

async function saveEmail(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/storage", async () => {
    const testTo = String(form.get("testTo") ?? "");
    const r = await saveEmailConfig(actor, { region: form.get("region"), from: form.get("from"), accessKeyId: form.get("accessKeyId"), secretAccessKey: form.get("secretAccessKey") ?? "" }, testTo);
    if (!r.verified) throw new PostError(`Saved, but the test email failed, so email stays off: ${r.error}`);
    return `Email works. A test message was sent to ${testTo}.`;
  });
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export default async function StoragePage({ searchParams }: { searchParams: FlashParams }) {
  const me = await requireRole("admin");
  const [s, e, migration, sp] = await Promise.all([storageSummary(), emailSummary(), migrationStatus(), searchParams]);
  const fromEnv = s?.source === "env";
  const plan = sp.plan === "1" && migration.legacy > 0 && s?.verifiedAt && migration.sourceConfigured ? await migrateBatch(actorOf(me), { dryRun: true, limit: 25 }) : null;
  return (
    <>
      <AdminHeader title="Storage & email" description="Media storage (Cloudflare R2) and outgoing email (Amazon SES). Keys are encrypted at rest and never shown again." />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="space-y-6">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-fg">Media storage (Cloudflare R2)</h2>
            <StatusPill status={s?.verifiedAt ? "ok" : s ? "degraded" : "not configured"} />
          </div>
          <p className="mb-4 text-sm text-fg-muted">
            Files are stored as <code className="break-all text-xs">{MEDIA_ROOT}/&#123;type&#125;/&#123;yyyy&#125;/&#123;mm&#125;/&#123;id&#125;.&#123;ext&#125;</code> in the bucket.
            Readers always use <code className="text-xs">/media/…</code> links on this site; large videos and documents are redirected to the public URL when one is set.
          </p>
          {fromEnv ? (
            <Alert tone="info">
              Configured by the Kubernetes Secret (R2_* environment variables): bucket <strong>{s.bucket}</strong>, endpoint <span className="break-all">{s.endpoint}</span>
              {s.publicBaseUrl ? <>, public URL <span className="break-all">{s.publicBaseUrl}</span></> : ", no public URL (served through the site)"}. Change it in the Secret and redeploy.
            </Alert>
          ) : (
            <form action={saveStorage} className="grid gap-4 sm:grid-cols-2">
              <Field label="Account ID" htmlFor="accountId" hint="Cloudflare dashboard → R2 → Account details (32 characters).">
                <Input id="accountId" name="accountId" defaultValue={s?.accountId ?? ""} required autoComplete="off" />
              </Field>
              <Field label="Bucket" htmlFor="bucket"><Input id="bucket" name="bucket" defaultValue={s?.bucket ?? ""} required /></Field>
              <Field label="Access key ID" htmlFor="accessKeyId" hint="An R2 API token scoped to this bucket (Object Read & Write)."><Input id="accessKeyId" name="accessKeyId" defaultValue={s?.accessKeyId ?? ""} required autoComplete="off" /></Field>
              <Field label="Secret access key" htmlFor="secretAccessKey" hint={s ? "Leave empty to keep the stored key." : undefined}><Input id="secretAccessKey" name="secretAccessKey" type="password" autoComplete="off" required={!s} /></Field>
              <Field label="Public media URL (optional)" htmlFor="publicBaseUrl" hint="A custom domain connected to the bucket, e.g. https://media.jithendar.com. Leave empty to serve everything through the site.">
                <Input id="publicBaseUrl" name="publicBaseUrl" type="url" defaultValue={s?.publicBaseUrl ?? ""} placeholder="https://media.example.com" />
              </Field>
              <Field label="API endpoint override (optional)" htmlFor="endpoint" hint="Only for an EU/FedRAMP jurisdiction bucket. Default: https://<account>.r2.cloudflarestorage.com">
                <Input id="endpoint" name="endpoint" type="url" defaultValue={s?.endpoint && !s.endpoint.endsWith(`${s.accountId}.r2.cloudflarestorage.com`) ? s.endpoint : ""} />
              </Field>
              <div className="sm:col-span-2"><Button type="submit" className="w-full sm:w-auto">Save and test connection</Button></div>
            </form>
          )}
        </Card>

        {(migration.legacy > 0 || migration.migrated > 0) && (
          <Card>
            <h2 className="font-semibold text-fg">Move existing media from S3 to R2</h2>
            <p className="mt-2 text-sm text-fg-muted">
              {migration.legacy} file(s) are still read from the old S3 bucket; {migration.migrated} have been copied to R2. Copying is resumable (25 per run), verified, and never deletes
              anything from S3. Links do not change: posts keep using <code className="text-xs">/media/&#123;id&#125;/…</code>.
            </p>
            {!migration.sourceConfigured && <div className="mt-4"><Alert>The legacy S3 configuration is missing, so files cannot be copied or rolled back.</Alert></div>}
            <div className="mt-4 flex flex-wrap gap-2">
              {migration.legacy > 0 && (
                <Link href="/admin/storage?plan=1" className="inline-flex items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold">
                  Dry run
                </Link>
              )}
              {migration.legacy > 0 && (
                <form action={migrate}>
                  <Button type="submit" disabled={!s?.verifiedAt || !migration.sourceConfigured}>Copy next 25</Button>
                </form>
              )}
              {migration.migrated > 0 && (
                <a href="/api/admin/media-migration" download className="inline-flex items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold">
                  Download manifest
                </a>
              )}
              {migration.migrated > 0 && (
                <form action={rollback}>
                  <Button type="submit" variant="ghost" disabled={!migration.sourceConfigured}>Roll back to S3</Button>
                </form>
              )}
            </div>
            {plan && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-medium">Dry run: the next {plan.entries.length} file(s) would be copied ({mb(plan.entries.reduce((n, x) => n + x.bytes, 0))}). Nothing was changed.</p>
                <Table head={<tr><th className={th}>Site URL</th><th className={th}>From (S3)</th><th className={th}>To (R2)</th></tr>}>
                  {plan.entries.map((x) => (
                    <tr key={x.id}>
                      <td className={`${td} whitespace-nowrap font-mono text-xs`}>{x.url}</td>
                      <td className={`${td} whitespace-nowrap font-mono text-xs`}>{x.oldKey}</td>
                      <td className={`${td} whitespace-nowrap font-mono text-xs`}>{x.newKey}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Card>
        )}

        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-fg">Email (Amazon SES)</h2>
            <StatusPill status={e?.verifiedAt ? "ok" : e ? "degraded" : "not configured"} />
          </div>
          <form action={saveEmail} className="grid gap-4 sm:grid-cols-2">
            <Field label="Region" htmlFor="ses-region"><Input id="ses-region" name="region" defaultValue={e?.region ?? "us-east-1"} required /></Field>
            <Field label="From address" htmlFor="ses-from" hint="A verified SES identity, e.g. Jithendar.com <no-reply@jithendar.com>"><Input id="ses-from" name="from" defaultValue={e?.from ?? ""} required /></Field>
            <Field label="Access key ID" htmlFor="ses-key"><Input id="ses-key" name="accessKeyId" defaultValue={e?.accessKeyId ?? ""} required autoComplete="off" /></Field>
            <Field label="Secret access key" htmlFor="ses-secret" hint={e ? "Leave empty to keep the stored key." : undefined}><Input id="ses-secret" name="secretAccessKey" type="password" autoComplete="off" required={!e} /></Field>
            <Field label="Send a test email to" htmlFor="testTo"><Input id="testTo" name="testTo" type="email" defaultValue={me.email} required /></Field>
            <div className="sm:col-span-2"><Button type="submit" className="w-full sm:w-auto">Save and send test email</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
