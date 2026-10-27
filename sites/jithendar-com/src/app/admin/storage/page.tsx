import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card, StatusPill } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui/form";
import { adminActor } from "@/lib/admin";
import { flash } from "@/lib/flash";
import { emailSummary, saveEmailConfig } from "@/lib/mail";
import { PostError } from "@/lib/posts";
import { requireRole } from "@/lib/session";
import { saveStorageConfig, storageSummary } from "@/lib/storage";

export const metadata = { title: "Storage & email" };

async function saveStorage(form: FormData) {
  "use server";
  const actor = await adminActor();
  await flash("/admin/storage", async () => {
    const r = await saveStorageConfig(actor, {
      endpoint: String(form.get("endpoint") ?? ""),
      region: String(form.get("region") ?? ""),
      bucket: String(form.get("bucket") ?? ""),
      prefix: String(form.get("prefix") ?? ""),
      forcePathStyle: form.has("forcePathStyle"),
      accessKeyId: String(form.get("accessKeyId") ?? ""),
      secretAccessKey: String(form.get("secretAccessKey") ?? ""),
    });
    if (!r.verified) throw new PostError(`Saved, but the connection test failed, so uploads stay disabled: ${r.error}`);
    return "Storage connected. Uploads are enabled.";
  });
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

export default async function StoragePage({ searchParams }: { searchParams: FlashParams }) {
  const me = await requireRole("admin");
  const [s, e, sp] = await Promise.all([storageSummary(), emailSummary(), searchParams]);
  return (
    <>
      <AdminHeader title="Storage & email" description="Media storage (any S3-compatible service) and outgoing email (Amazon SES). Keys are encrypted at rest and never shown again." />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="space-y-6">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-ink dark:text-white">Media storage (S3)</h2>
            <StatusPill status={s?.verifiedAt ? "ok" : s ? "degraded" : "not configured"} />
          </div>
          <form action={saveStorage} className="grid gap-4 sm:grid-cols-2">
            <Field label="Endpoint" htmlFor="endpoint" hint="Leave empty for AWS S3. R2/MinIO/B2: their S3 endpoint URL."><Input id="endpoint" name="endpoint" defaultValue={s?.endpoint ?? ""} placeholder="https://…" /></Field>
            <Field label="Region" htmlFor="region"><Input id="region" name="region" defaultValue={s?.region ?? "us-east-1"} required /></Field>
            <Field label="Bucket" htmlFor="bucket"><Input id="bucket" name="bucket" defaultValue={s?.bucket ?? ""} required /></Field>
            <Field label="Base folder (optional)" htmlFor="prefix" hint="Objects go under <folder>/media/<year>/<month>/…"><Input id="prefix" name="prefix" defaultValue={s?.prefix ?? ""} /></Field>
            <Field label="Access key ID" htmlFor="accessKeyId"><Input id="accessKeyId" name="accessKeyId" defaultValue={s?.accessKeyId ?? ""} required autoComplete="off" /></Field>
            <Field label="Secret access key" htmlFor="secretAccessKey" hint={s ? "Leave empty to keep the stored key." : undefined}><Input id="secretAccessKey" name="secretAccessKey" type="password" autoComplete="off" required={!s} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="forcePathStyle" defaultChecked={s?.forcePathStyle ?? false} /> Path-style URLs (MinIO and some others)</label>
            <div className="sm:col-span-2"><Button type="submit">Save and test connection</Button></div>
          </form>
        </Card>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-ink dark:text-white">Email (Amazon SES)</h2>
            <StatusPill status={e?.verifiedAt ? "ok" : e ? "degraded" : "not configured"} />
          </div>
          <form action={saveEmail} className="grid gap-4 sm:grid-cols-2">
            <Field label="Region" htmlFor="ses-region"><Input id="ses-region" name="region" defaultValue={e?.region ?? "us-east-1"} required /></Field>
            <Field label="From address" htmlFor="ses-from" hint="A verified SES identity, e.g. Jithendar.com <no-reply@jithendar.com>"><Input id="ses-from" name="from" defaultValue={e?.from ?? ""} required /></Field>
            <Field label="Access key ID" htmlFor="ses-key"><Input id="ses-key" name="accessKeyId" defaultValue={e?.accessKeyId ?? ""} required autoComplete="off" /></Field>
            <Field label="Secret access key" htmlFor="ses-secret" hint={e ? "Leave empty to keep the stored key." : undefined}><Input id="ses-secret" name="secretAccessKey" type="password" autoComplete="off" required={!e} /></Field>
            <Field label="Send a test email to" htmlFor="testTo"><Input id="testTo" name="testTo" type="email" defaultValue={me.email} required /></Field>
            <div className="sm:col-span-2"><Button type="submit">Save and send test email</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
