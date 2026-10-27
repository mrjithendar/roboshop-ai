"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openPreview } from "@/components/admin/openPreview";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui/form";
import { deletePageAction, savePageAction } from "./actions";

const RichEditor = dynamic(() => import("@/components/admin/RichEditor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="min-h-[480px] animate-pulse rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5" />,
});

export type PageFormValue = { slug: string; title: string; description: string; body: string; updatedAt: string | null };

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

export function PageEditor({ originalSlug, initial }: { originalSlug: string | null; initial: PageFormValue }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(Boolean(originalSlug));
  const [markUpdated, setMarkUpdated] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; issues?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof PageFormValue>(k: K, value: PageFormValue[K]) => setV((p) => ({ ...p, [k]: value }));

  function save() {
    const payload = { ...v, updatedAt: markUpdated ? new Date().toISOString() : v.updatedAt };
    setResult(null);
    start(async () => {
      const r = await savePageAction(originalSlug, payload);
      if (!r.ok) {
        setResult({ ok: false, message: r.error, issues: r.issues });
        return;
      }
      try {
        localStorage.removeItem(`draft:page:${originalSlug ?? "new"}`);
      } catch {
        /* ignore */
      }
      setMarkUpdated(false);
      setResult({ ok: true, message: r.message });
      if (r.id && r.id !== originalSlug) router.replace(`/admin/pages/${r.id}`);
      else router.refresh();
    });
  }

  async function preview() {
    const error = await openPreview("page", v);
    if (error) setResult({ ok: false, message: error });
  }

  function remove() {
    if (!originalSlug || !window.confirm(`Delete the page /${originalSlug}? It will return 404.`)) return;
    start(async () => {
      const r = await deletePageAction(originalSlug);
      if (r.ok) router.push("/admin/pages");
      else setResult({ ok: false, message: r.error });
    });
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Field label="Title" htmlFor="title">
          <Input id="title" value={v.title} className="text-lg font-semibold" onChange={(e) => { set("title", e.target.value); if (!touched) set("slug", slugify(e.target.value)); }} />
        </Field>
        <Field label="Summary" htmlFor="description" hint={`${v.description.length}/160. Used for search results and sharing.`}>
          <Textarea id="description" rows={2} maxLength={160} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <RichEditor value={v.body} onChange={(md) => set("body", md)} autosaveKey={`draft:page:${originalSlug ?? "new"}`} mediaContext={`pages/${v.slug || "draft"}`} />
      </div>
      <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-raised">
          <Field label="URL slug" htmlFor="slug" hint={`jithendar.com/${v.slug}. Changing it adds a redirect from the old URL.`}>
            <Input id="slug" value={v.slug} className="font-mono text-sm" onChange={(e) => { setTouched(true); set("slug", slugify(e.target.value)); }} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={markUpdated} onChange={(e) => setMarkUpdated(e.target.checked)} />
            <span>Show &ldquo;Last updated&rdquo; as now</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save & publish"}</Button>
            <Button type="button" variant="secondary" onClick={preview} title="Open the current, unsaved version in a new tab">Preview ↗</Button>
            {originalSlug && <Link href={`/${originalSlug}`} target="_blank" className="inline-flex items-center rounded-xl px-3 text-sm font-semibold underline">View ↗</Link>}
          </div>
          {result?.ok && <Alert tone="success">{result.message}</Alert>}
          {result && !result.ok && (
            <Alert>
              {result.message}
              {result.issues && result.issues.length > 0 && <ul className="mt-2 list-disc pl-5">{result.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            </Alert>
          )}
          {originalSlug && <Button type="button" variant="danger" onClick={remove} disabled={pending} className="w-full">Delete page</Button>}
        </div>
      </aside>
    </div>
  );
}
