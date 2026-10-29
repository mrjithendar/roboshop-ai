import { and, count, desc, eq, type SQL } from "drizzle-orm";
import Link from "next/link";
import { Flash, type FlashParams } from "@/components/admin/Flash";
import { AdminHeader, Card } from "@/components/admin/ui";
import { Alert } from "@/components/ui/form";
import { getDb, schema } from "@/db";
import { staffActor } from "@/lib/admin";
import { flash } from "@/lib/flash";
import { deleteMedia, mediaSrc } from "@/lib/media";
import { requireRole } from "@/lib/session";
import { MEDIA_KINDS, storageReady } from "@/lib/storage";
import { MediaUploader } from "./MediaUploader";

export const metadata = { title: "Media" };

const PAGE_SIZE = 48;

async function remove(form: FormData) {
  "use server";
  const actor = await staffActor();
  await flash(String(form.get("back") || "/admin/media"), async () => {
    await deleteMedia(actor, String(form.get("id")));
    return "File deleted.";
  });
}

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** The Markdown an author pastes to use the file. */
function snippet(m: { id: string; filename: string; kind: string; alt: string }) {
  const src = mediaSrc(m);
  if (m.kind === "images") return `![${m.alt}](${src})`;
  if (m.kind === "videos") return `::video{src="${src}"}`;
  if (m.kind === "audio") return `::audio{src="${src}"}`;
  return `[${m.alt || m.filename}](${src})`;
}

const ICON: Record<string, string> = { videos: "🎬", audio: "🎧", documents: "📄" };

export default async function MediaPage({ searchParams }: { searchParams: FlashParams }) {
  await requireRole("admin", "author");
  const sp = await searchParams;
  const kind = MEDIA_KINDS.find((k) => k === sp.kind);
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const db = await getDb();
  const where: SQL | undefined = and(eq(schema.media.status, "ready"), kind ? eq(schema.media.kind, kind) : undefined);
  const [items, [total], ready] = await Promise.all([
    db.select().from(schema.media).where(where).orderBy(desc(schema.media.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(schema.media).where(where),
    storageReady(),
  ]);
  const pages = Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE));
  const href = (k: string | undefined, p = 1) => {
    const q = new URLSearchParams({ ...(k ? { kind: k } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString();
    return q ? `/admin/media?${q}` : "/admin/media";
  };
  const here = href(kind, page);

  return (
    <>
      <AdminHeader title="Media" description="Images, video, audio and PDFs in Cloudflare R2. Links (/media/…) never change, even if the storage does." />
      <Flash ok={sp.ok} error={sp.error} />
      {ready ? (
        <Card className="mb-8">
          <MediaUploader />
        </Card>
      ) : (
        <div className="mb-8">
          <Alert tone="info">
            Uploads are disabled until media storage is configured. <Link href="/admin/storage" className="font-semibold underline">Configure Cloudflare R2</Link>.
          </Alert>
        </div>
      )}

      <nav aria-label="Filter by type" className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
        {[undefined, ...MEDIA_KINDS].map((k) => (
          <Link
            key={k ?? "all"}
            href={href(k)}
            aria-current={k === kind ? "page" : undefined}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium capitalize ${k === kind ? "bg-ink text-white dark:bg-white dark:text-ink" : "bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10"}`}
          >
            {k ?? "All"}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No files here yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {items.map((m) => {
            const src = mediaSrc(m);
            const code = snippet(m);
            return (
              <li key={m.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-surface-dark-raised">
                {m.kind === "images" && m.visibility === "public" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
                  <img src={src} alt={m.alt} loading="lazy" width={m.width ?? undefined} height={m.height ?? undefined} className="aspect-[4/3] w-full bg-slate-100 object-cover dark:bg-white/5" />
                ) : (
                  <a href={src} target="_blank" rel="noopener" className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 text-4xl dark:bg-white/5">
                    <span aria-hidden="true">{ICON[m.kind] ?? "🖼️"}</span>
                    <span className="sr-only">Open {m.filename}</span>
                  </a>
                )}
                <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                  <p className="truncate font-medium text-ink dark:text-white" title={m.alt || m.filename}>{m.alt || m.filename}</p>
                  <p className="text-slate-500">
                    {m.width && m.height ? `${m.width}×${m.height} · ` : ""}
                    {size(m.sizeBytes)} · {m.kind}
                    {m.visibility === "private" ? " · private" : ""}
                    {m.storageBackend !== "r2" ? " · on S3" : ""}
                  </p>
                  <code className="block truncate text-[11px] text-slate-500" title={code}>{code}</code>
                  <form action={remove} className="mt-auto pt-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="back" value={here} />
                    <button type="submit" className="min-h-6 text-red-600 underline">Delete</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-8 flex items-center justify-between gap-4 text-sm">
          {page > 1 ? <Link href={href(kind, page - 1)} className="rounded-lg px-3 py-2 font-medium underline">← Newer</Link> : <span />}
          <span className="text-slate-500">Page {page} of {pages}</span>
          {page < pages ? <Link href={href(kind, page + 1)} className="rounded-lg px-3 py-2 font-medium underline">Older →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
