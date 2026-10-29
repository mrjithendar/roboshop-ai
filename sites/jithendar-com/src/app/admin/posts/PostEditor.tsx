"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import type { GenerateOptions } from "@/components/admin/GenerateImageDialog";
import { Panel, PreviewDialog, RevisionsPanel, SaveIndicator, SearchPreview, SocialPreview, type SaveState } from "@/components/admin/editor/EditorChrome";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { Source } from "@/db/schema";
import { isoToIstInput, istInputToIso } from "@/lib/ist";
import type { PostFormValue } from "@/lib/post-form";
import {
  autosavePostAction,
  checkSlugAction,
  discardAutosaveAction,
  listPostRevisionsAction,
  loadLatestPostAction,
  loadPostRevisionAction,
  savePostAction,
  trashPostAction,
  type SaveIntent,
} from "./actions";

export type { PostFormValue };

// Browser-only: Tiptap needs the DOM.
const BlockEditor = dynamic(() => import("@/components/admin/editor/BlockEditor").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => <div className="min-h-[480px] animate-pulse rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5" />,
});

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
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const sourcesToText = (s: Source[]) => s.map((x) => `${x.title} | ${x.url} | ${x.publisher}`).join("\n");
const textToSources = (t: string): Source[] =>
  t
    .split("\n")
    .map((l) => l.split("|").map((p) => p.trim()))
    .filter((p) => p.length >= 3 && p[0])
    .map(([title, url, publisher]) => ({ title: title!, url: url!, publisher: publisher! }));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const localKey = (userId: string, id: string | null) => `editor:${userId}:post:${id ?? "new"}`;

export type Autosaved = { value: PostFormValue; savedAt: string; baseVersion: number } | null;

/**
 * The post editor. The committed version (what readers see when published) only changes on
 * Save draft / Publish / Update; edits in between are autosaved as this user's working copy
 * (server-side for existing posts, browser storage for new ones) and offered for recovery.
 */
export function PostEditor({
  id,
  initial,
  version: initialVersion = 1,
  autosaved = null,
  userId,
  authorName,
  categories,
  imageGeneration,
}: {
  id: string | null;
  initial: PostFormValue;
  version?: number;
  autosaved?: Autosaved;
  userId: string;
  authorName: string;
  categories: { slug: string; label: string }[];
  imageGeneration: GenerateOptions;
}) {
  const router = useRouter();
  const [v, setV] = useState<PostFormValue>(initial);
  const [committed, setCommitted] = useState<PostFormValue>(initial);
  const [version, setVersion] = useState(initialVersion);
  const [sources, setSources] = useState(sourcesToText(initial.sources));
  const [slugTouched, setSlugTouched] = useState(Boolean(id));
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [substantive, setSubstantive] = useState(false);
  const [state, setState] = useState<SaveState>({ kind: "saved" });
  const [issues, setIssues] = useState<string[]>([]);
  const [conflict, setConflict] = useState<{ version: number; savedAt: string } | null>(null);
  const [recovery, setRecovery] = useState<Autosaved>(() => (autosaved && !same(autosaved.value, initial) ? autosaved : null));
  const [localDismissed, setLocalDismissed] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [sidebar, setSidebar] = useState(false);
  const [focus, setFocus] = useState(false);
  const [preview, setPreview] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const busy = useRef(false);

  const current: PostFormValue = useMemo(() => ({ ...v, sources: textToSources(sources) }), [v, sources]);
  const dirty = !same(current, committed);
  const set = <K extends keyof PostFormValue>(k: K, value: PostFormValue[K]) => setV((p) => ({ ...p, [k]: value }));
  const context = `posts/${v.collection}/${v.slug || "draft"}`;
  const publicPath = `/${v.collection}/${v.slug}`;
  const isLive = committed.status === "published";
  const isScheduled = committed.status === "scheduled";
  const futureDate = Boolean(v.publishedAt && Date.parse(v.publishedAt) > openedAt + 30_000);

  // Browser copy for new posts (and as a last resort when the server cannot be reached), read once on open.
  const storedLocal = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(localKey(userId, id));
      } catch {
        return null;
      }
    },
    () => null,
  );
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  // Freeze the first value read after hydration: later writes are this session's own autosaves.
  const [initialLocal, setInitialLocal] = useState<string | null | undefined>(undefined);
  if (hydrated && initialLocal === undefined) setInitialLocal(storedLocal);
  const localRecovery = useMemo(() => {
    const raw = initialLocal;
    if (!raw || localDismissed) return null;
    try {
      const saved = JSON.parse(raw) as PostFormValue;
      return same(saved, initial) ? null : saved;
    } catch {
      return null;
    }
  }, [initialLocal, localDismissed, initial]);

  // Debounced autosave of the working copy.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(async () => {
      try {
        localStorage.setItem(localKey(userId, id), JSON.stringify(current));
      } catch {
        /* storage unavailable */
      }
      if (!id || busy.current) return;
      setState({ kind: "autosaving" });
      const r = await autosavePostAction(id, version, current).catch(() => null);
      setState(r?.ok ? { kind: "autosaved", at: r.savedAt } : { kind: "error", message: r && !r.ok ? r.error : "Autosave failed — you may be offline. Your changes are kept in this browser." });
    }, 2500);
    return () => window.clearTimeout(t);
  }, [current, dirty, id, version, userId]);

  // Warn before leaving with uncommitted changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Live permalink check.
  useEffect(() => {
    if (!SLUG.test(v.slug)) return;
    const t = window.setTimeout(() => void checkSlugAction(v.collection, v.slug, id).then((r) => setSlugAvailable(r.available)), 400);
    return () => window.clearTimeout(t);
  }, [v.slug, v.collection, id]);

  const commit = useCallback(
    async (intent: SaveIntent, overwriteVersion?: number) => {
      if (busy.current) return;
      busy.current = true;
      setState({ kind: "saving" });
      setIssues([]);
      const payload: PostFormValue = {
        ...current,
        updatedAt: substantive && isLive ? new Date().toISOString() : current.updatedAt,
        canonicalUrl: current.canonicalUrl || null,
        sponsor: current.sponsored ? current.sponsor : null,
      };
      const r = await savePostAction(id, payload, intent, overwriteVersion ?? (id ? version : undefined)).catch(() => null);
      busy.current = false;
      if (!r) return setState({ kind: "error", message: "Could not reach the server. Your changes are kept in this browser; try again." });
      if (!r.ok) {
        if (r.conflict) setConflict(r.conflict);
        setIssues(r.issues ?? []);
        return setState({ kind: "error", message: r.error });
      }
      const saved: PostFormValue = { ...payload, status: r.status as PostFormValue["status"], publishedAt: r.publishedAt ?? payload.publishedAt };
      setV(saved);
      setCommitted(saved);
      setVersion(r.version);
      setConflict(null);
      setSubstantive(false);
      setRecovery(null);
      try {
        localStorage.removeItem(localKey(userId, id));
      } catch {
        /* ignore */
      }
      setState({ kind: "saved", at: r.savedAt, message: r.message });
      if (!id) router.replace(`/admin/posts/${r.id}`);
    },
    [current, id, version, substantive, isLive, router, userId],
  );

  // Ctrl/⌘ S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void commit("save");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  function load(value: PostFormValue) {
    setV(value);
    setSources(sourcesToText(value.sources));
    setEditorKey((k) => k + 1);
  }

  async function loadLatest() {
    if (!id) return;
    try {
      localStorage.setItem(localKey(userId, id), JSON.stringify(current)); // keep the user's version recoverable
    } catch {
      /* ignore */
    }
    const latest = await loadLatestPostAction(id);
    load(latest.value);
    setCommitted(latest.value);
    setVersion(latest.version);
    setConflict(null);
    setState({ kind: "saved", message: "Loaded the latest version. Your edits are kept as a browser recovery copy." });
  }

  async function trash() {
    if (!id || !window.confirm("Move this post to the trash? It disappears from the site and can be restored from Posts → Trash.")) return;
    const r = await trashPostAction(id);
    if (r.ok) router.push("/admin/posts");
    else setState({ kind: "error", message: r.error });
  }

  const primary = isLive ? "Update" : futureDate ? (isScheduled ? "Update schedule" : "Schedule…") : "Publish";
  const primaryIntent: SaveIntent = isLive ? "save" : "publish";

  return (
    <div className={focus ? "fixed inset-0 z-40 overflow-y-auto bg-white dark:bg-surface-dark" : ""}>
      {/* Top bar */}
      <div className={`sticky top-0 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border dark:border-white/10 dark:bg-surface-dark/95 ${focus ? "mx-0 rounded-none" : ""}`}>
        <Link href="/admin/posts" className="rounded-lg px-2 py-2 text-sm font-medium text-slate-600 hover:text-ink dark:text-slate-300"
          onClick={(e) => { if (dirty && !window.confirm("You have unsaved changes. Leave anyway? (They are autosaved as a recovery copy.)")) e.preventDefault(); }}>
          ← Posts
        </Link>
        <SaveIndicator state={state} dirty={dirty} status={committed.status} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => setFocus((f) => !f)} aria-pressed={focus} title="Distraction-free writing">{focus ? "Exit focus" : "Focus"}</Button>
          <Button type="button" variant="secondary" onClick={() => setPreview(true)}>Preview</Button>
          {!isLive && <Button type="button" variant="secondary" onClick={() => commit("save")} disabled={state.kind === "saving"}>{isScheduled ? "Save" : "Save draft"}</Button>}
          <Button type="button" onClick={() => {
            if (primaryIntent === "publish" && futureDate && !window.confirm(`Schedule this post to publish on ${new Date(v.publishedAt!).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST?`)) return;
            void commit(primaryIntent);
          }} disabled={state.kind === "saving"}>{primary}</Button>
          <Button type="button" variant="ghost" onClick={() => setSidebar((s) => !s)} aria-expanded={sidebar} aria-controls="post-settings" className="xl:hidden">Settings</Button>
        </div>
      </div>

      <div className={`grid grid-cols-[minmax(0,1fr)] gap-8 ${focus ? "mx-auto max-w-3xl px-4 pb-16" : "xl:grid-cols-[minmax(0,1fr)_340px]"}`}>
        <div className="min-w-0 space-y-4">
          {recovery && (
            <Alert tone="info">
              You have autosaved changes from {new Date(recovery.savedAt).toLocaleString()}{recovery.baseVersion < version ? ", based on an older version of this post" : ""}.{" "}
              <button type="button" className="font-semibold underline" onClick={() => { load(recovery.value); setRecovery(null); }}>Restore them</button>{" · "}
              <button type="button" className="underline" onClick={() => { if (id) void discardAutosaveAction(id); setRecovery(null); }}>Discard</button>
            </Alert>
          )}
          {!recovery && localRecovery && (
            <Alert tone="info">
              This browser has unsaved changes from an earlier session.{" "}
              <button type="button" className="font-semibold underline" onClick={() => { load(localRecovery); setLocalDismissed(true); }}>Restore them</button>{" · "}
              <button type="button" className="underline" onClick={() => { try { localStorage.removeItem(localKey(userId, id)); } catch { /* ignore */ } setLocalDismissed(true); }}>Discard</button>
            </Alert>
          )}
          {conflict && (
            <Alert>
              Someone saved a newer version at {new Date(conflict.savedAt).toLocaleString()}.{" "}
              <button type="button" className="font-semibold underline" onClick={loadLatest}>Load the latest version</button>{" · "}
              <button type="button" className="underline" onClick={() => window.confirm("Replace the newer version with yours? It stays in the revision history.") && commit(isLive ? "save" : "save", conflict.version)}>Overwrite with mine</button>
            </Alert>
          )}
          {issues.length > 0 && (
            <Alert>
              <ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </Alert>
          )}
          {isLive && dirty && <p className="text-sm text-amber-700 dark:text-amber-300">Changes are not public until you click Update.</p>}

          <label htmlFor="title" className="sr-only">Title</label>
          <textarea id="title" rows={1} value={v.title} maxLength={110} placeholder="Add title"
            onChange={(e) => { set("title", e.target.value.replace(/\n/g, " ")); if (!slugTouched) set("slug", slugify(e.target.value)); }}
            className="block w-full resize-none bg-transparent text-3xl font-bold tracking-tight text-ink placeholder:text-slate-400 focus:outline-none sm:text-4xl dark:text-white [field-sizing:content]" />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <span>Permalink:</span>
            <span className="break-all font-mono text-xs">jithendar.com/{v.collection}/</span>
            <label htmlFor="slug-inline" className="sr-only">URL slug</label>
            <input id="slug-inline" value={v.slug} onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs dark:border-white/10 dark:bg-surface-dark-raised" />
            {!SLUG.test(v.slug) ? <span className="text-red-600">lowercase letters, numbers and hyphens</span> : slugAvailable === false ? <span className="text-red-600">already used</span> : null}
            {isLive && committed.slug !== v.slug && <span className="text-amber-700 dark:text-amber-300">The old URL will redirect here.</span>}
          </div>

          <BlockEditor key={editorKey} value={v.body} onChange={(md) => set("body", md)} mediaContext={context} />
        </div>

        <aside id="post-settings" aria-label="Post settings"
          className={`${sidebar ? "fixed inset-0 z-50 overflow-y-auto bg-white p-4 dark:bg-surface-dark" : "hidden"} ${focus ? "" : "xl:static xl:block xl:bg-transparent xl:p-0"} space-y-3 xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto`}>
          <div className="flex items-center justify-between xl:hidden">
            <h2 className="font-semibold text-ink dark:text-white">Post settings</h2>
            <Button type="button" variant="ghost" onClick={() => setSidebar(false)} aria-label="Close settings">✕</Button>
          </div>

          <Panel title="Status & publishing" open>
            <p className="text-sm">Status: <strong className="capitalize">{committed.status}</strong>{isScheduled && committed.publishedAt ? ` for ${new Date(committed.publishedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}</p>
            <Field label="Publish date & time (India Standard Time)" htmlFor="publishedAt" hint="Leave empty to publish now. A future time schedules the post; the server publishes it at that time.">
              <Input id="publishedAt" type="datetime-local" value={isoToIstInput(v.publishedAt)} onChange={(e) => set("publishedAt", istInputToIso(e.target.value))} />
            </Field>
            {!isLive && (
              <Field label="Workflow" htmlFor="status">
                <Select id="status" value={v.status === "review" ? "review" : "draft"} onChange={(e) => set("status", e.target.value as PostFormValue["status"])}>
                  <option value="draft">Draft</option>
                  <option value="review">Ready for review</option>
                </Select>
              </Field>
            )}
            {isLive && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={substantive} onChange={(e) => setSubstantive(e.target.checked)} />
                <span>Substantive update (shows “Updated” with the current time — do not use for typo fixes)</span>
              </label>
            )}
            {v.updatedAt && <p className="text-xs text-slate-500">Last substantive update: {new Date(v.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>}
            {(isLive || isScheduled) && <Button type="button" variant="ghost" onClick={() => window.confirm("Switch to draft? The post is removed from the site.") && commit("unpublish")}>Switch to draft</Button>}
            {isLive && <Link href={publicPath} target="_blank" className="block text-sm font-semibold underline">View post ↗</Link>}
            <p className="text-xs text-slate-500">Author: {authorName}</p>
          </Panel>

          <Panel title="Featured image">
            <CoverImagePicker value={v.featuredImage} onChange={(img) => set("featuredImage", img)} context={context} generate={{ ...imageGeneration, title: v.title, summary: v.description }} />
          </Panel>

          <Panel title="Excerpt" open>
            <Field label="Summary" htmlFor="description" hint={`${v.description.length}/160 (at least 50). Shown on cards, in feeds and as the default search snippet.`}>
              <Textarea id="description" rows={3} maxLength={160} value={v.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </Panel>

          <Panel title="Categories & tags">
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
            <Field label="Tags" htmlFor="tags" hint="Comma separated. Use a few precise tags.">
              <Input id="tags" value={v.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} />
            </Field>
          </Panel>

          <Panel title="Search appearance">
            <SearchPreview url={`jithendar.com${publicPath}`} title={v.seoTitle || v.title} description={v.seoDescription || v.description} />
            <Field label="SEO title (optional)" htmlFor="seoTitle" hint={`${(v.seoTitle ?? "").length} characters. Defaults to the post title.`}>
              <Input id="seoTitle" value={v.seoTitle ?? ""} maxLength={110} onChange={(e) => set("seoTitle", e.target.value || null)} />
            </Field>
            <Field label="Meta description (optional)" htmlFor="seoDescription" hint={`${(v.seoDescription ?? "").length}/160. Defaults to the summary.`}>
              <Textarea id="seoDescription" rows={3} maxLength={160} value={v.seoDescription ?? ""} onChange={(e) => set("seoDescription", e.target.value || null)} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={v.noindex} onChange={(e) => set("noindex", e.target.checked)} />
              <span>Hide from search engines (noindex; left out of sitemaps)</span>
            </label>
            <Field label="Canonical URL override" htmlFor="canonical" hint="Only when this post was first published elsewhere and should credit that URL. Leave empty otherwise.">
              <Input id="canonical" type="url" value={v.canonicalUrl ?? ""} onChange={(e) => set("canonicalUrl", e.target.value || null)} placeholder="https://…" />
            </Field>
          </Panel>

          <Panel title="Social sharing">
            <SocialPreview title={v.socialTitle || v.seoTitle || v.title} description={v.socialDescription || v.seoDescription || v.description} image={(v.socialImage ?? v.featuredImage)?.src} />
            <Field label="Social title (optional)" htmlFor="socialTitle"><Input id="socialTitle" value={v.socialTitle ?? ""} maxLength={110} onChange={(e) => set("socialTitle", e.target.value || null)} /></Field>
            <Field label="Social description (optional)" htmlFor="socialDescription"><Textarea id="socialDescription" rows={2} maxLength={200} value={v.socialDescription ?? ""} onChange={(e) => set("socialDescription", e.target.value || null)} /></Field>
            <CoverImagePicker label="Social image (optional; defaults to the featured image)" value={v.socialImage} onChange={(img) => set("socialImage", img)} context={context} />
          </Panel>

          <Panel title="Sources, related & sponsorship">
            <Field label="Sources" htmlFor="sources" hint="One per line: Title | https://url | Publisher. Required for News and Curated summaries.">
              <Textarea id="sources" rows={4} value={sources} onChange={(e) => setSources(e.target.value)} className="font-mono text-xs" />
            </Field>
            <Field label="Related posts" htmlFor="related" hint="One per line, e.g. blog/deploy-nextjs-kubernetes-github-actions">
              <Textarea id="related" rows={2} value={v.related.join("\n")} className="font-mono text-xs" onChange={(e) => set("related", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.sponsored} onChange={(e) => set("sponsored", e.target.checked)} /> Sponsored content</label>
            {v.sponsored && <Field label="Sponsor" htmlFor="sponsor"><Input id="sponsor" value={v.sponsor ?? ""} onChange={(e) => set("sponsor", e.target.value)} /></Field>}
          </Panel>

          {id && (
            <Panel title="Revisions">
              <RevisionsPanel
                list={() => listPostRevisionsAction(id)}
                load={async (revId) => {
                  if (dirty && !window.confirm("Load this revision into the editor? Your current unsaved changes are replaced (they stay in the autosave copy).")) return;
                  load(await loadPostRevisionAction(id, revId));
                  setState({ kind: "saved", message: "Revision loaded. Save to make it the current version; history is kept." });
                }}
                preview={async (revId) => loadPostRevisionAction(id, revId)}
                kind="post"
              />
            </Panel>
          )}

          {id && (
            <div className="pt-2">
              <Button type="button" variant="danger" onClick={trash} className="w-full">Move to trash</Button>
            </div>
          )}
        </aside>
      </div>

      <PreviewDialog open={preview} onClose={() => setPreview(false)} kind="post" payload={current} />
    </div>
  );
}
