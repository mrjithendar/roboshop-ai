"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { AlertIcon, CheckIcon, ExternalIcon } from "@/components/icons";
import { Alert, Button, inputClass, Spinner } from "@/components/ui/form";
import { defaultConfig, validateConfig, type SiteConfig } from "@/lib/site-config/schema";
import { summarizeChangesClient } from "./diff";
import { discardDraftAction, publishAction, saveDraftAction, type Conflict } from "./actions";
import { EditorContext, setIn } from "./fields";
import { HistoryPanel, TransferPanel } from "./history";
import { HomepagePanel } from "./homepage";
import { NavigationPanel } from "./menus";
import { AdvancedPanel, BlogPanel, BrandingPanel, FooterPanel, GeneralPanel, HeaderPanel, MediaPanel, SeoPanel, ThemePanel } from "./panels";

export type EditorContext = {
  categories: { slug: string; label: string }[];
  authors: { slug: string; name: string }[];
  pages: { path: string; title: string }[];
  samplePaths: { path: string; label: string }[];
  published: SiteConfig;
  publishedVersion: number;
  publishedAt: string | null;
  status: {
    storage: boolean;
    mail: boolean;
    turnstile: boolean;
    gemini: boolean;
    oauth: string[];
    googleVerification: number;
    bingVerification: number;
    ga4: boolean;
    ga4Active: boolean;
    adsense: { slots: number; test: boolean } | null;
    adsTxt: boolean;
    consentDefault: string;
    indexNow: boolean;
  };
};

const SECTIONS = [
  { id: "general", label: "General", prefix: ["general"] },
  { id: "branding", label: "Branding", prefix: ["branding"] },
  { id: "header", label: "Header", prefix: ["header"] },
  { id: "navigation", label: "Navigation", prefix: ["navigation"] },
  { id: "footer", label: "Footer", prefix: ["footer"] },
  { id: "theme", label: "Typography & colours", prefix: ["theme"] },
  { id: "homepage", label: "Homepage", prefix: ["homepage"] },
  { id: "blog", label: "Blog & articles", prefix: ["blog"] },
  { id: "media", label: "Media", prefix: ["media"] },
  { id: "seo", label: "SEO & integrations", prefix: ["seo"] },
  { id: "advanced", label: "Advanced", prefix: ["advanced"] },
  { id: "history", label: "Revision history", prefix: [] },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

const DEVICES = [
  { id: "phone", label: "Phone", width: 390 },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "desktop", label: "Desktop", width: 1280 },
] as const;

export function AppearanceEditor({
  initial,
  context,
  initialSection,
}: {
  initial: { config: unknown; version: number; baseVersion: number; updatedAt: string | null };
  context: EditorContext;
  initialSection?: string;
}) {
  const [section, setSection] = useState<SectionId>(SECTIONS.some((s) => s.id === initialSection) ? (initialSection as SectionId) : "general");
  const [draft, setDraft] = useState<unknown>(initial.config);
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string; list?: string[] } | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [published, setPublished] = useState({ config: context.published, version: context.publishedVersion });

  const draftRef = useRef(draft);
  const versionRef = useRef(initial.version);
  const savedJson = useRef(JSON.stringify(initial.config));
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<number> | null>(null);

  const check = useMemo(() => validateConfig(draft), [draft]);
  const issues = useMemo(() => (check.ok ? [] : check.issues), [check]);
  const changes = useMemo(() => summarizeChangesClient(published.config, check.ok ? check.config : draft), [published.config, draft, check]);

  /** Save now if anything changed; resolves to the current draft version. */
  const save = useCallback(async (): Promise<number> => {
    if (inflight.current) await inflight.current;
    const json = JSON.stringify(draftRef.current);
    if (json === savedJson.current) {
      setState((s) => (s === "pending" ? "saved" : s));
      return versionRef.current;
    }
    setState("saving");
    const run = (async () => {
      const r = await saveDraftAction(draftRef.current, versionRef.current);
      if (r.ok) {
        versionRef.current = r.version;
        savedJson.current = json;
        setState(JSON.stringify(draftRef.current) === json ? "saved" : "pending");
      } else if (r.conflict) {
        setConflict(r.conflict);
        setState("conflict");
      } else {
        setState("error");
        setMessage({ tone: "error", text: r.error });
      }
      return versionRef.current;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    return save();
  }, [save]);

  const update = useCallback(
    (next: unknown) => {
      draftRef.current = next;
      setDraft(next);
      setState("pending");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), 1000);
    },
    [save],
  );

  const set = useCallback((path: string, value: unknown) => update(setIn(draftRef.current, path, value)), [update]);

  /** Replace the draft with a server-provided one (restore, discard, conflict resolution). */
  const replace = useCallback((config: unknown, version: number) => {
    window.clearTimeout(timer.current);
    draftRef.current = config;
    versionRef.current = version;
    savedJson.current = JSON.stringify(config);
    setDraft(config);
    setState("saved");
  }, []);

  // Warn before leaving with unsaved edits; keep the section in the URL for bookmarks.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (state === "pending" || state === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [state]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    window.history.replaceState(null, "", url);
  }, [section]);

  const sectionIssues = (id: SectionId) => issues.filter((i) => SECTIONS.find((s) => s.id === id)!.prefix.some((p) => i.path === p || i.path.startsWith(`${p}.`))).length;
  const api = useMemo(() => ({ draft, set, issues }), [draft, set, issues]);
  const current = SECTIONS.find((s) => s.id === section)!;

  async function publish(note: string) {
    const version = await flush();
    const r = await publishAction(version, note);
    if (r.ok) {
      setPublished({ config: draftRef.current as SiteConfig, version: r.version });
      // Publishing bumps the draft version server-side (the draft is rebased on what went live).
      versionRef.current = version + 1;
      setPublishOpen(false);
      setMessage({ tone: "success", text: `Published as version ${r.version}. The site is updated on every server.` });
    } else if (r.conflict) {
      setPublishOpen(false);
      setConflict(r.conflict);
      setState("conflict");
    } else {
      setMessage({ tone: "error", text: r.error, list: r.issues });
    }
  }

  async function discard() {
    if (!window.confirm("Discard all unpublished changes? The draft returns to what is live.")) return;
    window.clearTimeout(timer.current);
    const r = await discardDraftAction();
    if (r.ok) {
      replace(r.config, r.version);
      setMessage({ tone: "info", text: "Draft discarded. It now matches the live site." });
    } else setMessage({ tone: "error", text: r.error });
  }

  return (
    <EditorContext.Provider value={api}>
      <div className="space-y-6">
        {/* Title and lifecycle actions */}
        <div className="sticky top-header z-20 -mx-4 border-b border-line bg-canvas px-4 py-3 sm:mx-0 sm:rounded-b-xl sm:border sm:border-t-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight text-fg">Appearance &amp; site settings</h1>
              <SaveStatus state={state} issues={issues.length} changes={changes.length} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={discard} disabled={changes.length === 0 && state === "saved"}>
                Discard draft
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await flush();
                  setPreviewOpen(true);
                }}
              >
                Preview
              </Button>
              <Button type="button" size="sm" onClick={() => setPublishOpen(true)} disabled={state === "conflict"}>
                Publish
              </Button>
            </div>
          </div>
        </div>

        {conflict && (
          <Alert>
            Another administrator saved the draft{conflict.updatedAt ? ` at ${new Date(conflict.updatedAt).toLocaleTimeString()}` : ""} while you were editing.
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => (replace(conflict.config, conflict.version), setConflict(null))}>
                Load their version
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  versionRef.current = conflict.version;
                  savedJson.current = "";
                  setConflict(null);
                  void save();
                }}
              >
                Keep mine (overwrite)
              </Button>
            </div>
          </Alert>
        )}
        {message && (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Alert tone={message.tone}>
                {message.text}
                {message.list && (
                  <ul className="mt-1 list-disc pl-5">
                    {message.list.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </Alert>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMessage(null)}>
              Dismiss
            </Button>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="xl:sticky xl:top-[calc(var(--spacing-header)+6rem)] xl:self-start">
            <label className="block xl:hidden">
              <span className="sr-only">Section</span>
              <select value={section} onChange={(e) => setSection(e.target.value as SectionId)} className={inputClass}>
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {sectionIssues(s.id) ? ` (${sectionIssues(s.id)} to fix)` : ""}
                  </option>
                ))}
              </select>
            </label>
            <ul className="hidden space-y-0.5 xl:block">
              {SECTIONS.map((s) => {
                const n = sectionIssues(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSection(s.id)}
                      aria-current={s.id === section ? "page" : undefined}
                      className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-medium transition-colors ${s.id === section ? "bg-accent-soft text-accent-text" : "text-fg-muted hover:bg-surface-sunken hover:text-fg"}`}
                    >
                      {s.label}
                      {n > 0 && (
                        <span className="rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-800 dark:bg-red-500/20 dark:text-red-200">
                          {n}
                          <span className="sr-only"> problems</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 space-y-6">
            <h2 className="sr-only">{current.label}</h2>
            {section === "general" && <GeneralPanel />}
            {section === "branding" && <BrandingPanel />}
            {section === "header" && <HeaderPanel ctx={context} />}
            {section === "navigation" && <NavigationPanel ctx={context} />}
            {section === "footer" && <FooterPanel />}
            {section === "theme" && <ThemePanel />}
            {section === "homepage" && <HomepagePanel ctx={context} />}
            {section === "blog" && <BlogPanel />}
            {section === "media" && <MediaPanel ctx={context} />}
            {section === "seo" && <SeoPanel ctx={context} />}
            {section === "advanced" && <AdvancedPanel />}
            {section === "history" && (
              <>
                <HistoryPanel
                  flush={flush}
                  onLoaded={(config, version, text) => {
                    replace(config, version);
                    setMessage({ tone: "success", text });
                  }}
                />
                <TransferPanel
                  onImport={(config, text) => {
                    update(config);
                    setMessage({ tone: "info", text });
                  }}
                  onReset={() => {
                    update(defaultConfig());
                    setMessage({ tone: "info", text: "Every setting in the draft is back to its default. Publish to apply." });
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <PreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} paths={context.samplePaths} />
      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} issues={issues} changes={changes} onPublish={publish} />
    </EditorContext.Provider>
  );
}

function SaveStatus({ state, issues, changes }: { state: SaveState; issues: number; changes: number }) {
  const text =
    state === "saving" ? "Saving draft…" : state === "pending" ? "Unsaved changes" : state === "error" ? "Draft not saved" : state === "conflict" ? "Edit conflict" : changes > 0 ? `Draft saved · ${changes} unpublished change${changes === 1 ? "" : "s"}` : "Draft matches the live site";
  return (
    <p role="status" aria-live="polite" className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-fg-subtle">
      {state === "saving" ? <Spinner className="h-3.5 w-3.5" /> : state === "error" || state === "conflict" ? <AlertIcon className="h-3.5 w-3.5 text-red-600" /> : <CheckIcon className="h-3.5 w-3.5" />}
      {text}
      {issues > 0 && <span className="text-red-700 dark:text-red-300">· {issues} to fix before publishing</span>}
    </p>
  );
}

/** The real site, rendered with the draft (admin-only preview cookie), at phone, tablet and desktop widths. */
function PreviewDialog({ open, onClose, paths }: { open: boolean; onClose: () => void; paths: { path: string; label: string }[] }) {
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const [path, setPath] = useState(paths[0]?.path ?? "/");
  const [nonce, setNonce] = useState(0);
  const width = DEVICES.find((d) => d.id === device)!.width;
  const src = `/api/admin/appearance/preview?path=${encodeURIComponent(path)}&n=${nonce}`;
  const close = () => {
    // End the preview session so other tabs show the live site again.
    void fetch("/api/admin/appearance/preview?exit=1", { redirect: "manual", cache: "no-store" });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Preview the draft"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Device width" className="flex gap-1">
            {DEVICES.map((d) => (
              <Button key={d.id} type="button" size="sm" variant={device === d.id ? "primary" : "secondary"} aria-pressed={device === d.id} onClick={() => setDevice(d.id)}>
                {d.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
              Reload
            </Button>
            <a href={src} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-text hover:underline">
              Open in a new tab <ExternalIcon className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      }
    >
      <label className="mb-3 block max-w-sm text-sm">
        <span className="mb-1 block font-medium text-fg">Page</span>
        <select value={path} onChange={(e) => setPath(e.target.value)} className={inputClass}>
          {paths.map((p) => (
            <option key={p.path} value={p.path}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mb-3 text-sm text-fg-subtle">Only you can see this preview; it is never cached or indexed. Links inside the preview keep showing the draft until you close it.</p>
      {open && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface-sunken p-2">
          <iframe key={src} title={`Draft preview at ${width}px`} src={src} style={{ width }} className="mx-auto block h-[65dvh] max-w-none rounded-lg border-0 bg-white" />
        </div>
      )}
    </Dialog>
  );
}

function PublishDialog({ open, onClose, issues, changes, onPublish }: { open: boolean; onClose: () => void; issues: { path: string; message: string }[]; changes: string[]; onPublish: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Publish changes"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={issues.length > 0 || changes.length === 0}
            onClick={async () => {
              setBusy(true);
              await onPublish(note);
              setBusy(false);
              setNote("");
            }}
          >
            Publish now
          </Button>
        </div>
      }
    >
      {issues.length > 0 ? (
        <Alert>
          Fix these first:
          <ul className="mt-1 list-disc pl-5">
            {issues.slice(0, 12).map((i) => (
              <li key={i.path + i.message}>
                <span className="font-mono text-xs">{i.path}</span>: {i.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : changes.length === 0 ? (
        <p className="text-sm text-fg-muted">The draft matches the live site. There is nothing to publish.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">These areas will change for every reader as soon as you publish. You can restore the current version later from Revision history.</p>
          <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-fg">
            {changes.map((c) => (
              <li key={c} className="font-mono text-xs">
                {c}
              </li>
            ))}
          </ul>
          <label className="block space-y-1.5 text-sm">
            <span className="block font-medium text-fg">Note for the history (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={inputClass} placeholder="e.g. New header and footer" />
          </label>
        </div>
      )}
    </Dialog>
  );
}
