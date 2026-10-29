"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Panel, PreviewDialog, RevisionsPanel, SaveIndicator, SearchPreview, type SaveState } from "@/components/admin/editor/EditorChrome";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui/form";
import type { PageFormValue } from "@/lib/site-pages";
import { autosavePageAction, discardPageAutosaveAction, listPageRevisionsAction, loadPageRevisionAction, savePageAction, trashPageAction } from "./actions";

export type { PageFormValue };

const BlockEditor = dynamic(() => import("@/components/admin/editor/BlockEditor").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => <div className="min-h-[480px] animate-pulse rounded-2xl border border-line bg-surface-muted" />,
});

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Page editor: pages are always live once saved (no draft workflow), so edits between saves are
 * autosaved as the user's working copy and only reach readers on Save. Pages have no categories,
 * tags, authors or schedules; they do have SEO settings and a menu order.
 */
export function PageEditor({
  originalSlug,
  initial,
  version: initialVersion = 1,
  autosaved = null,
  bundled = null,
}: {
  originalSlug: string | null;
  initial: PageFormValue;
  version?: number;
  autosaved?: { value: PageFormValue; savedAt: string; baseVersion: number } | null;
  /** The bundled draft from content/pages/ when it differs from what is saved. */
  bundled?: PageFormValue | null;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [committed, setCommitted] = useState(initial);
  const [version, setVersion] = useState(initialVersion);
  const [touched, setTouched] = useState(Boolean(originalSlug));
  const [markUpdated, setMarkUpdated] = useState(false);
  const [state, setState] = useState<SaveState>({ kind: "saved" });
  const [issues, setIssues] = useState<string[]>([]);
  const [conflict, setConflict] = useState<{ version: number; savedAt: string } | null>(null);
  const [recovery, setRecovery] = useState(autosaved && !same(autosaved.value, initial) ? autosaved : null);
  const [preview, setPreview] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const dirty = !same(v, committed);
  const set = <K extends keyof PageFormValue>(k: K, value: PageFormValue[K]) => setV((p) => ({ ...p, [k]: value }));

  useEffect(() => {
    if (!dirty || !originalSlug) return;
    const t = window.setTimeout(async () => {
      setState({ kind: "autosaving" });
      const r = await autosavePageAction(originalSlug, version, v).catch(() => null);
      setState(r?.ok ? { kind: "autosaved", at: r.savedAt } : { kind: "error", message: "Autosave failed — you may be offline." });
    }, 2500);
    return () => window.clearTimeout(t);
  }, [v, dirty, originalSlug, version]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useCallback(
    async (overwrite?: number) => {
      setState({ kind: "saving" });
      setIssues([]);
      const payload = { ...v, updatedAt: markUpdated ? new Date().toISOString() : v.updatedAt };
      const r = await savePageAction(originalSlug, payload, overwrite ?? (originalSlug ? version : undefined)).catch(() => null);
      if (!r) return setState({ kind: "error", message: "Could not reach the server. Try again." });
      if (!r.ok) {
        if (r.conflict) setConflict(r.conflict);
        setIssues(r.issues ?? []);
        return setState({ kind: "error", message: r.error });
      }
      setV(payload);
      setCommitted(payload);
      setVersion(r.version);
      setConflict(null);
      setMarkUpdated(false);
      setRecovery(null);
      setState({ kind: "saved", at: r.savedAt, message: r.message });
      if (r.slug !== originalSlug) router.replace(`/admin/pages/${r.slug}`);
    },
    [v, markUpdated, originalSlug, version, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  function load(value: PageFormValue) {
    setV(value);
    setEditorKey((k) => k + 1);
  }

  return (
    <div>
      <div className="sticky top-header z-20 -mx-4 mb-6 flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-4 py-2 sm:mx-0 sm:rounded-b-xl sm:border sm:border-t-0 sm:px-3 [[data-editor-focus]_&]:top-0">
        <Link href="/admin/pages" className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-fg-muted hover:bg-surface-sunken hover:text-fg"
          onClick={(e) => { if (dirty && !window.confirm("You have unsaved changes. Leave anyway?")) e.preventDefault(); }}>← Pages</Link>
        <SaveIndicator state={state} dirty={dirty} status="live" />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setPreview(true)}>Preview</Button>
          <Button type="button" onClick={() => save()} disabled={state.kind === "saving"}>{originalSlug ? "Update" : "Publish page"}</Button>
          <Button type="button" variant="ghost" className="xl:hidden" onClick={() => setSidebar((s) => !s)} aria-expanded={sidebar} aria-controls="page-settings">Settings</Button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {bundled && (
            <Alert tone="info">
              An updated draft of this page ships with the site (content/pages/{bundled.slug}.mdx).{" "}
              <button type="button" className="font-semibold underline" onClick={() => { if (!dirty || window.confirm("Replace the editor contents with the bundled draft? Nothing is saved until you click Update.")) load({ ...bundled, slug: v.slug || bundled.slug }); }}>
                Load it for review
              </button>
              . Review every line (items marked “Owner input needed” must be completed) before saving.
            </Alert>
          )}
          {recovery && (
            <Alert tone="info">
              You have autosaved changes from {new Date(recovery.savedAt).toLocaleString()}.{" "}
              <button type="button" className="font-semibold underline" onClick={() => { load(recovery.value); setRecovery(null); }}>Restore them</button>{" · "}
              <button type="button" className="underline" onClick={() => { if (originalSlug) void discardPageAutosaveAction(originalSlug); setRecovery(null); }}>Discard</button>
            </Alert>
          )}
          {conflict && (
            <Alert>
              Someone saved a newer version at {new Date(conflict.savedAt).toLocaleString()}.{" "}
              <button type="button" className="font-semibold underline" onClick={() => router.refresh()}>Reload</button>{" · "}
              <button type="button" className="underline" onClick={() => window.confirm("Replace the newer version with yours? It stays in the revision history.") && save(conflict.version)}>Overwrite with mine</button>
            </Alert>
          )}
          {issues.length > 0 && <Alert><ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul></Alert>}

          <label htmlFor="title" className="sr-only">Title</label>
          <textarea id="title" rows={1} value={v.title} maxLength={110} placeholder="Page title"
            onChange={(e) => { set("title", e.target.value.replace(/\n/g, " ")); if (!touched) set("slug", slugify(e.target.value)); }}
            className="block w-full resize-none bg-transparent text-3xl font-bold tracking-tight text-fg placeholder:text-slate-400 focus:outline-none sm:text-4xl [field-sizing:content]" />
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-mono text-xs">jithendar.com/</span>
            <label htmlFor="slug" className="sr-only">URL slug</label>
            <input id="slug" value={v.slug} onChange={(e) => { setTouched(true); set("slug", slugify(e.target.value)); }}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs" />
            {originalSlug && originalSlug !== v.slug && <span className="text-amber-700 dark:text-amber-300">The old URL will redirect here.</span>}
          </div>
          <BlockEditor key={editorKey} value={v.body} onChange={(md) => set("body", md)} mediaContext={`pages/${v.slug || "draft"}`} />
        </div>

        <aside id="page-settings" aria-label="Page settings" className={`${sidebar ? "fixed inset-0 z-50 overflow-y-auto bg-white p-4 dark:bg-surface-dark" : "hidden"} space-y-3 xl:static xl:block xl:bg-transparent xl:p-0`}>
          <div className="flex items-center justify-between xl:hidden">
            <h2 className="font-semibold text-fg">Page settings</h2>
            <Button type="button" variant="ghost" onClick={() => setSidebar(false)} aria-label="Close settings">✕</Button>
          </div>
          <Panel title="Summary" open>
            <Field label="Description" htmlFor="description" hint={`${v.description.length}/160 (at least 50). Used as the meta description and in the header.`}>
              <Textarea id="description" rows={3} maxLength={160} value={v.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={markUpdated} onChange={(e) => setMarkUpdated(e.target.checked)} />
              <span>Show “Last updated” with the current date (for meaningful changes)</span>
            </label>
            <Field label="Menu order" htmlFor="sortOrder" hint="Order in the “Publication info” navigation; lower comes first.">
              <Input id="sortOrder" type="number" min={0} max={10000} value={v.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value) || 0)} />
            </Field>
          </Panel>
          <Panel title="Search appearance">
            <SearchPreview url={`jithendar.com/${v.slug}`} title={v.seoTitle || v.title} description={v.seoDescription || v.description} />
            <Field label="SEO title (optional)" htmlFor="seoTitle"><Input id="seoTitle" value={v.seoTitle ?? ""} maxLength={110} onChange={(e) => set("seoTitle", e.target.value || null)} /></Field>
            <Field label="Meta description (optional)" htmlFor="seoDescription"><Textarea id="seoDescription" rows={3} maxLength={160} value={v.seoDescription ?? ""} onChange={(e) => set("seoDescription", e.target.value || null)} /></Field>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={v.noindex} onChange={(e) => set("noindex", e.target.checked)} /> <span>Hide from search engines (noindex)</span></label>
          </Panel>
          {originalSlug && (
            <Panel title="Revisions">
              <RevisionsPanel kind="page" list={() => listPageRevisionsAction(originalSlug)} preview={(id) => loadPageRevisionAction(originalSlug, id)}
                load={async (id) => { if (!dirty || window.confirm("Load this revision into the editor? Unsaved changes are replaced.")) load(await loadPageRevisionAction(originalSlug, id)); }} />
            </Panel>
          )}
          {originalSlug && (
            <Button type="button" variant="danger" className="w-full" onClick={async () => {
              if (!window.confirm("Move this page to the trash? Its URL returns “not found” until it is restored.")) return;
              const r = await trashPageAction(originalSlug);
              if (r.ok) router.push("/admin/pages");
              else setState({ kind: "error", message: r.error });
            }}>Move to trash</Button>
          )}
        </aside>
      </div>
      <PreviewDialog open={preview} onClose={() => setPreview(false)} kind="page" payload={v} />
    </div>
  );
}
