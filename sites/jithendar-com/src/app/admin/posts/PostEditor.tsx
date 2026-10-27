"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import dynamic from "next/dynamic";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { FeaturedImage, Source } from "@/db/schema";
import { isoToIstInput, istInputToIso } from "@/lib/ist";
import { removePost, savePost } from "./actions";

// Browser-only: the editor reads local autosave and Tiptap needs the DOM.
const RichEditor = dynamic(() => import("@/components/admin/RichEditor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="min-h-[480px] animate-pulse rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5" />,
});

export type PostFormValue = {
  collection: "blog" | "news" | "projects";
  slug: string;
  title: string;
  description: string;
  body: string;
  category: string;
  tags: string[];
  contentType: string;
  status: "draft" | "review" | "published" | "archived";
  publishedAt: string | null;
  updatedAt: string | null;
  canonicalUrl: string | null;
  featuredImage: FeaturedImage | null;
  sources: Source[];
  sponsored: boolean;
  sponsor: string | null;
  related: string[];
};

const TYPES: Record<PostFormValue["collection"], { value: string; label: string }[]> = {
  blog: [
    { value: "tutorial", label: "Tutorial" },
    { value: "analysis", label: "Analysis" },
    { value: "opinion", label: "Opinion" },
    { value: "curated", label: "Curated summary" },
  ],
  news: [
    { value: "news", label: "News" },
    { value: "analysis", label: "Analysis" },
  ],
  projects: [{ value: "project", label: "Project" }],
};

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 80);

const sourcesToText = (s: Source[]) => s.map((x) => `${x.title} | ${x.url} | ${x.publisher}`).join("\n");
const textToSources = (t: string): Source[] =>
  t
    .split("\n")
    .map((l) => l.split("|").map((p) => p.trim()))
    .filter((p) => p.length >= 3 && p[0])
    .map(([title, url, publisher]) => ({ title: title!, url: url!, publisher: publisher! }));

export function PostEditor({ id, initial, categories }: { id: string | null; initial: PostFormValue; categories: { slug: string; label: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState<PostFormValue>(initial);
  const [slugTouched, setSlugTouched] = useState(Boolean(id));
  const [sources, setSources] = useState(sourcesToText(initial.sources));
  const [substantive, setSubstantive] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; issues?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof PostFormValue>(k: K, value: PostFormValue[K]) => setV((p) => ({ ...p, [k]: value }));
  const context = useMemo(() => `posts/${v.collection}/${v.slug || "draft"}`, [v.collection, v.slug]);
  const publicPath = `/${v.collection}/${v.slug}`;

  function save(status?: PostFormValue["status"]) {
    const next = { ...v, ...(status ? { status } : {}) };
    if (next.status === "published" && !next.publishedAt) next.publishedAt = istInputToIso(isoToIstInput(new Date().toISOString()));
    const payload = {
      ...next,
      sources: textToSources(sources),
      updatedAt: substantive ? new Date().toISOString() : next.updatedAt,
      canonicalUrl: next.canonicalUrl || null,
      sponsor: next.sponsored ? next.sponsor : null,
    };
    setResult(null);
    start(async () => {
      const r = await savePost(id, payload);
      if (!r.ok) {
        setResult({ ok: false, message: r.error, issues: r.issues });
        return;
      }
      try {
        localStorage.removeItem(`draft:${id ?? "new"}`);
      } catch {
        /* ignore */
      }
      setV(next);
      setSubstantive(false);
      setResult({ ok: true, message: r.message });
      if (!id && r.id) router.replace(`/admin/posts/${r.id}`);
      else router.refresh();
    });
  }

  function remove() {
    if (!id || !window.confirm("Delete this post permanently?")) return;
    start(async () => {
      const r = await removePost(id);
      if (r.ok) router.push("/admin/posts");
      else setResult({ ok: false, message: r.error });
    });
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Field label="Title" htmlFor="title" hint={`${v.title.length}/110`}>
          <Input id="title" value={v.title} maxLength={110} className="text-lg font-semibold"
            onChange={(e) => { set("title", e.target.value); if (!slugTouched) set("slug", slugify(e.target.value)); }} />
        </Field>
        <Field label="Summary" htmlFor="description" hint={`${v.description.length}/160. Shown on cards, in search results and when shared.`}>
          <Textarea id="description" rows={2} maxLength={160} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <RichEditor value={v.body} onChange={(md) => set("body", md)} autosaveKey={`draft:${id ?? "new"}`} mediaContext={context} />
        <details className="rounded-2xl border border-slate-200 p-5 dark:border-white/10">
          <summary className="cursor-pointer font-semibold text-ink dark:text-white">Sources, related posts and sponsorship</summary>
          <div className="mt-5 space-y-5">
            <Field label="Sources" htmlFor="sources" hint="One per line: Title | https://url | Publisher. Required for News and Curated summaries.">
              <Textarea id="sources" rows={4} value={sources} onChange={(e) => setSources(e.target.value)} className="font-mono text-xs" />
            </Field>
            <Field label="Related posts" htmlFor="related" hint="One per line, e.g. blog/deploy-nextjs-kubernetes-github-actions">
              <Textarea id="related" rows={2} value={v.related.join("\n")} className="font-mono text-xs"
                onChange={(e) => set("related", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
            </Field>
            <Field label="Canonical URL (only for syndicated posts)" htmlFor="canonical">
              <Input id="canonical" type="url" value={v.canonicalUrl ?? ""} onChange={(e) => set("canonicalUrl", e.target.value)} placeholder="https://…" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.sponsored} onChange={(e) => set("sponsored", e.target.checked)} /> Sponsored content
            </label>
            {v.sponsored && (
              <Field label="Sponsor" htmlFor="sponsor">
                <Input id="sponsor" value={v.sponsor ?? ""} onChange={(e) => set("sponsor", e.target.value)} />
              </Field>
            )}
          </div>
        </details>
      </div>

      <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-raised">
          <Field label="Status" htmlFor="status">
            <Select id="status" value={v.status} onChange={(e) => set("status", e.target.value as PostFormValue["status"])}>
              <option value="draft">Draft</option>
              <option value="review">In review</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Field label="Publish time (IST)" htmlFor="publishedAt" hint="A future time schedules the post.">
            <Input id="publishedAt" type="datetime-local" value={isoToIstInput(v.publishedAt)} onChange={(e) => set("publishedAt", istInputToIso(e.target.value))} />
          </Field>
          {id && v.status === "published" && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={substantive} onChange={(e) => setSubstantive(e.target.checked)} />
              <span>Substantive update (shows &ldquo;Updated&rdquo; with the current time)</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => save()} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            {v.status !== "published" && <Button type="button" variant="secondary" onClick={() => save("published")} disabled={pending}>Publish</Button>}
            {id && v.status === "published" && <Link href={publicPath} target="_blank" className="inline-flex items-center rounded-xl px-3 text-sm font-semibold underline">View ↗</Link>}
          </div>
          {result?.ok && <Alert tone="success">{result.message}</Alert>}
          {result && !result.ok && (
            <Alert>
              {result.message}
              {result.issues && result.issues.length > 0 && <ul className="mt-2 list-disc pl-5">{result.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            </Alert>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-raised">
          <CoverImagePicker value={v.featuredImage} onChange={(img) => set("featuredImage", img)} context={context} />
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-raised">
          <Field label="Section" htmlFor="collection">
            <Select id="collection" value={v.collection} onChange={(e) => {
              const c = e.target.value as PostFormValue["collection"];
              setV((p) => ({ ...p, collection: c, contentType: TYPES[c].some((t) => t.value === p.contentType) ? p.contentType : TYPES[c][0]!.value }));
            }}>
              <option value="blog">Articles</option>
              <option value="news">News</option>
              <option value="projects">Projects</option>
            </Select>
          </Field>
          <Field label="Type" htmlFor="contentType">
            <Select id="contentType" value={v.contentType} onChange={(e) => set("contentType", e.target.value)}>
              {TYPES[v.collection].map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" value={v.category} onChange={(e) => set("category", e.target.value)}>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Tags" htmlFor="tags" hint="Comma separated.">
            <Input id="tags" value={v.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} />
          </Field>
          <Field label="URL slug" htmlFor="slug" hint={`jithendar.com${publicPath}. Changing it later adds a redirect from the old URL.`}>
            <Input id="slug" value={v.slug} onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }} className="font-mono text-sm" />
          </Field>
          {id && <Button type="button" variant="danger" onClick={remove} disabled={pending} className="w-full">Delete post</Button>}
        </div>
      </aside>
    </div>
  );
}
