"use client";

import { useEffect, useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui/form";
import { defaultConfig, type SiteConfig } from "@/lib/site-config/schema";
import { exportAction, listRevisionsAction, previewImportAction, restoreRevisionAction } from "./actions";
import { Panel } from "./fields";

type Revision = { id: string; version: number; reason: string; author: string | null; createdAt: string };

/** Revision history: every publish is kept; any of them can be loaded into the draft or restored as a new revision. */
export function HistoryPanel({ onLoaded, flush }: { onLoaded: (config: unknown, version: number, message: string) => void; flush: () => Promise<number> }) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await listRevisionsAction();
      if (r.ok) setRevisions(r.revisions);
      else setError(r.error);
    });
  // Fetch once on mount; the list also refreshes after a restore.
  useEffect(load, []);

  function restore(rev: Revision, mode: "draft" | "publish") {
    if (mode === "publish" && !window.confirm(`Make version ${rev.version} live again? It is published as a new version; nothing is deleted.`)) return;
    start(async () => {
      const current = await flush();
      const r = await restoreRevisionAction(rev.id, mode, current);
      if (!r.ok) {
        setError([r.error, ...(r.issues ?? [])].join(" "));
        return;
      }
      onLoaded(r.config, r.version, mode === "publish" ? `Version ${rev.version} is live again (as a new version).` : `Version ${rev.version} loaded into the draft. Review it, then publish.`);
      load();
    });
  }

  return (
    <Panel title="Published versions" description="Each publish is recorded with who made it and when. Restoring never deletes history.">
      {error && <Alert>{error}</Alert>}
      {!revisions && <div className="skeleton h-24" aria-label="Loading" />}
      {revisions && revisions.length === 0 && <p className="text-sm text-fg-subtle">Nothing has been published from this editor yet. The site uses its built-in defaults and earlier settings.</p>}
      {revisions && revisions.length > 0 && (
        <ol className="divide-y divide-line rounded-lg border border-line">
          {revisions.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">
                  Version {r.version} {i === 0 && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100">Live</span>}
                </p>
                <p className="text-sm text-fg-subtle">
                  {new Date(r.createdAt).toLocaleString()} · {r.author ?? "unknown"} · {r.reason}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => restore(r, "draft")}>
                  Load into draft
                </Button>
                {i > 0 && (
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => restore(r, "publish")}>
                    Restore now
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Export the non-secret settings as JSON; import a file into the draft after reviewing what changes. */
export function TransferPanel({ onImport, onReset }: { onImport: (config: SiteConfig, message: string) => void; onReset: () => void }) {
  const [preview, setPreview] = useState<{ config: SiteConfig; changes: string[]; warnings: string[] } | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  function download(which: "published" | "draft") {
    start(async () => {
      const r = await exportAction(which);
      if (!r.ok) return setError([r.error]);
      const url = URL.createObjectURL(new Blob([r.json], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `jithendar-settings-${which}-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function choose(file: File | undefined) {
    setPreview(null);
    setError(null);
    if (!file) return;
    if (file.size > 512_000) return setError(["The file is too large (512 KB at most)."]);
    const text = await file.text();
    start(async () => {
      const r = await previewImportAction(text);
      if (r.ok) setPreview(r);
      else setError([r.error, ...(r.issues ?? [])]);
    });
  }

  return (
    <>
      <Panel title="Export and import" description="Exports contain appearance and site settings only: never passwords, API keys, tokens or user data. Imports are validated, may only reference images already in this site's media library, and land in the draft for review.">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => download("published")}>
            Export published settings
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => download("draft")}>
            Export draft
          </Button>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="block font-medium text-fg">Import a settings file (.json)</span>
          <input type="file" accept="application/json,.json" onChange={(e) => choose(e.target.files?.[0])} className="block w-full text-sm text-fg-muted file:mr-3 file:min-h-10 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-fg" />
        </label>
        {error && (
          <Alert>
            <ul className="list-disc pl-5">
              {error.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
        {preview && (
          <div className="space-y-3 rounded-lg border border-line p-4">
            <p className="text-sm font-semibold text-fg">{preview.changes.length === 0 ? "This file matches the current draft." : `${preview.changes.length} area(s) will change:`}</p>
            {preview.changes.length > 0 && (
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-fg-muted">
                {preview.changes.map((c) => (
                  <li key={c} className="font-mono text-xs">
                    {c}
                  </li>
                ))}
              </ul>
            )}
            {preview.warnings.length > 0 && (
              <Alert tone="info">
                <ul className="list-disc pl-5">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={preview.changes.length === 0} onClick={() => (onImport(preview.config, "Imported into the draft. Preview it, then publish."), setPreview(null))}>
                Import into draft
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Reset" description="Puts every setting back to the built-in defaults in the draft. Nothing changes for readers until you publish.">
        <Button type="button" variant="danger" onClick={() => window.confirm("Reset every appearance and site setting in the draft to the defaults?") && onReset()}>
          Reset all settings to defaults
        </Button>
      </Panel>
    </>
  );
}

export const DEFAULTS = defaultConfig();
