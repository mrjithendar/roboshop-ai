"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StatusPill, td, th } from "@/components/admin/ui";
import { Alert, Button } from "@/components/ui/form";
import { bulkPosts } from "./actions";

export type PostRowView = { id: string; title: string; collection: string; status: string; category: string; author: string; saved: string; cover: string | null };

export function BulkPosts({ rows }: { rows: PostRowView[] }) {
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

  function act(action: "publish" | "draft" | "archive" | "delete") {
    if (action === "delete" && !window.confirm(`Delete ${selected.size} post(s) permanently?`)) return;
    start(async () => {
      const r = await bulkPosts([...selected], action);
      setMessage(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error, issues: r.issues });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-surface-dark-raised">
          <span className="mr-2 text-sm font-medium">{selected.size} selected</span>
          <Button variant="secondary" disabled={pending} onClick={() => act("publish")}>Publish</Button>
          <Button variant="secondary" disabled={pending} onClick={() => act("draft")}>Move to draft</Button>
          <Button variant="secondary" disabled={pending} onClick={() => act("archive")}>Archive</Button>
          <Button variant="danger" disabled={pending} onClick={() => act("delete")}>Delete</Button>
        </div>
      )}
      {message && (
        <Alert tone={message.ok ? "success" : "error"}>
          {message.text}
          {message.issues && <ul className="mt-2 list-disc pl-5">{message.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        </Alert>
      )}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-surface-dark-raised">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-white/10">
          <thead className="bg-slate-50 dark:bg-white/[0.03]">
            <tr>
              <th className={th}>
                <input type="checkbox" aria-label="Select all posts" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
              </th>
              <th className={th}>Post</th>
              <th className={th}>Status</th>
              <th className={th}>Section</th>
              <th className={th}>Author</th>
              <th className={th}>Last saved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
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
                  <Link href={`/admin/posts/${r.id}`} className="flex items-center gap-3 font-medium text-ink hover:underline dark:text-white">
                    {r.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
                      <img src={r.cover} alt="" className="h-10 w-16 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="h-10 w-16 shrink-0 rounded-md bg-slate-100 dark:bg-white/5" aria-hidden="true" />
                    )}
                    {r.title}
                  </Link>
                </td>
                <td className={td}><StatusPill status={r.status} /></td>
                <td className={td}>{r.collection} · {r.category}</td>
                <td className={td}>{r.author}</td>
                <td className={`${td} whitespace-nowrap`}>{r.saved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
