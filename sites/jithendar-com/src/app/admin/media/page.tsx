import { desc } from "drizzle-orm";
import Link from "next/link";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card } from "@/components/admin/ui";
import { Alert, Button, Field, Input } from "@/components/ui/form";
import { getDb, schema } from "@/db";
import { staffActor } from "@/lib/admin";
import { flash } from "@/lib/flash";
import { deleteMedia, storeUpload } from "@/lib/media";
import { requireRole } from "@/lib/session";
import { storageReady } from "@/lib/storage";

export const metadata = { title: "Media" };

async function upload(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/media", async () => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new (await import("@/lib/posts")).PostError("Choose an image.");
    const r = await storeUpload({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, String(form.get("alt") ?? ""), actor.id, "library");
    if (!r.ok) throw new (await import("@/lib/posts")).PostError(r.error);
    return "Uploaded.";
  });
}

async function remove(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash("/admin/media", async () => {
    await deleteMedia(actor, String(form.get("id")));
    return "Image deleted.";
  });
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default async function MediaPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin", "author");
  const db = await getDb();
  const [items, ready, sp] = await Promise.all([db.select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(300), storageReady(), searchParams]);
  return (
    <>
      <AdminHeader title="Media" description="Images stored in S3, organised as media/<year>/<month>/<context>/." />
      <Flash ok={sp.ok} error={sp.error} />
      {ready ? (
        <Card className="mb-8">
          <form action={upload} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Image" htmlFor="file" hint="JPEG, PNG, WebP, AVIF or GIF, up to 5 MB.">
              <Input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" required />
            </Field>
            <Field label="Alt text" htmlFor="alt"><Input id="alt" name="alt" required maxLength={200} /></Field>
            <Button type="submit">Upload</Button>
          </form>
        </Card>
      ) : (
        <div className="mb-8">
          <Alert tone="info">
            Uploads are disabled until media storage is configured. <Link href="/admin/storage" className="font-semibold underline">Configure S3 storage</Link>.
          </Alert>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No uploads yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => {
            const src = `/media/${m.id}/${m.filename}`;
            return (
              <li key={m.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-surface-dark-raised">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail */}
                <img src={src} alt={m.alt} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                <div className="space-y-1 p-3 text-xs">
                  <p className="truncate font-medium text-ink dark:text-white" title={m.alt}>{m.alt}</p>
                  <p className="text-slate-500">{m.width}×{m.height} · {kb(m.sizeBytes)} · {m.context}</p>
                  <code className="block truncate text-[11px] text-slate-500" title={`![${m.alt}](${src})`}>![{m.alt}]({src})</code>
                  <form action={remove}>
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="mt-1 text-red-600 underline">Delete</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
