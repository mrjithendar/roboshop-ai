"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StatusPill, td, th } from "@/components/admin/ui";
import { Alert, Button } from "@/components/ui/form";
import { bulkPosts, duplicatePostAction, previewPostAction } from "./actions";

export type PostRowView = {
  id: string;
  title: string;
  collection: string;
  slug: string;
  status: string;
  category: string;
  author: string;
  saved: string;
  scheduledFor: string | null;
  cover: string | null;
};

type Action = "publish" | "draft" | "archive" | "trash" | "restore" | "delete";
const CONFIRM: Partial<Record<Action, (n: number) => string>> = {
  publish: (n) => `Publish ${n} post(s) now? Posts with a future date are scheduled instead.`,
  trash: (n) => `Move ${n} post(s) to the trash? They disappear from the site and can be restored.`,
  delete: (n) => `Permanently delete ${n} post(s)? This cannot be undone.`,
};

export function BulkPosts({ rows, trash = false }: { rows: PostRowView[]; trash?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const all = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function act(action: Action, ids: string[] = [...selected]) {
    const confirm = CONFIRM[action];
    if (confirm && !window.confirm(confirm(ids.length))) return;
    start(async () => {
      const r = await bulkPosts(ids, action);
      setMessage(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error, issues: r.issues });
      setSelected(new Set());
      router.refresh();
    });
  }

  async function preview(id: string) {
    const tab = window.open("about:blank", "_blank");
    const r = await previewPostAction(id);
    if (r.ok && tab) tab.location.href = `/preview/${r.token}`;
    else {
      tab?.close();
      if (!r.ok) setMessage({ ok: false, text: r.error });
    }
  }

  function duplicate(id: string) {
    start(async () => {
      const r = await duplicatePostAction(id);
      if (r.ok && r.id) router.push(`/admin/posts/${r.id}`);
      else if (!r.ok) setMessage({ ok: false, text: r.error });
    });
  }

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
          <span className="mr-2 text-sm font-medium">{selected.size} selected</span>
          {trash ? (
            <>
              <Button variant="secondary" disabled={pending} onClick={() => act("restore")}>Restore</Button>
              <Button variant="danger" disabled={pending} onClick={() => act("delete")}>Delete permanently</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={pending} onClick={() => act("publish")}>Publish</Button>
              <Button variant="secondary" disabled={pending} onClick={() => act("draft")}>Move to draft</Button>
              <Button variant="secondary" disabled={pending} onClick={() => act("archive")}>Archive</Button>
              <Button variant="danger" disabled={pending} onClick={() => act("trash")}>Move to trash</Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}
      {message && (
        <Alert tone={message.ok ? "success" : "error"}>
          {message.text}
          {message.issues && <ul className="mt-2 list-disc pl-5">{message.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        </Alert>
      )}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
        <table className="min-w-full divide-y divide-line">
          <thead className="bg-surface-muted">
            <tr>
              <th className={th}>
                <input type="checkbox" aria-label="Select all posts" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
              </th>
              <th className={th}>Post</th>
              <th className={th}>Status</th>
              <th className={th}>Section</th>
              <th className={th}>Author</th>
              <th className={th}>{trash ? "Trashed" : "Last saved"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td className={td} colSpan={6}>No posts match.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-brand-50/50 dark:bg-brand-500/5" : undefined}>
                <td className={td}>
                  <input type="checkbox" aria-label={`Select ${r.title}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className={`${td} min-w-56`}>
                  {trash ? (
                    <span className="font-medium text-fg">{r.title}</span>
                  ) : (
                    <Link href={`/admin/posts/${r.id}`} className="flex items-center gap-3 font-medium text-fg hover:underline">
                      {r.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
                        <img src={r.cover} alt="" className="h-10 w-16 shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="h-10 w-16 shrink-0 rounded-md bg-slate-100 dark:bg-white/5" aria-hidden="true" />
                      )}
                      {r.title}
                    </Link>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    {trash ? (
                      <>
                        <button type="button" className="font-semibold text-accent-text underline" onClick={() => act("restore", [r.id])}>Restore</button>
                        <button type="button" className="font-semibold text-red-600 underline" onClick={() => act("delete", [r.id])}>Delete permanently</button>
                      </>
                    ) : (
                      <>
                        <Link href={`/admin/posts/${r.id}`} className="font-semibold underline">Edit</Link>
                        {r.status === "published" ? (
                          <a href={`/${r.collection}/${r.slug}`} target="_blank" rel="noopener" className="font-semibold underline">View ↗</a>
                        ) : (
                          <button type="button" className="font-semibold underline" onClick={() => preview(r.id)}>Preview ↗</button>
                        )}
                        <button type="button" className="font-semibold underline" onClick={() => duplicate(r.id)}>Duplicate</button>
                        <button type="button" className="font-semibold text-red-600 underline" onClick={() => act("trash", [r.id])}>Trash</button>
                      </>
                    )}
                  </div>
                </td>
                <td className={td}>
                  <StatusPill status={trash ? "trash" : r.status} />
                  {r.scheduledFor && <p className="mt-1 whitespace-nowrap text-xs text-slate-500">{r.scheduledFor}</p>}
                </td>
                <td className={td}>{r.collection} · {r.category}</td>
                <td className={td}>{r.author}</td>
                <td className={`${td} whitespace-nowrap`}>{trash ? "Trashed " : ""}{r.saved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
