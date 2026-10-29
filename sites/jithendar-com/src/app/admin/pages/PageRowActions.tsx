"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { deletePageAction, restorePageAction, trashPageAction } from "./actions";

export function PageRowActions({ slug, trash }: { slug: string; trash: boolean }) {
  const router = useRouter();
  async function run(action: (s: string) => Promise<{ ok: boolean; error?: string }>, confirm: string) {
    if (!window.confirm(confirm)) return;
    const r = await action(slug);
    if (!r.ok) window.alert(r.error);
    router.refresh();
  }
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
      {trash ? (
        <>
          <button type="button" className="font-semibold text-brand-700 underline dark:text-brand-300" onClick={() => run(restorePageAction, `Restore /${slug}?`)}>Restore</button>
          <button type="button" className="font-semibold text-red-600 underline" onClick={() => run(deletePageAction, `Permanently delete /${slug}? This cannot be undone.`)}>Delete permanently</button>
        </>
      ) : (
        <>
          <Link href={`/admin/pages/${slug}`} className="font-semibold underline">Edit</Link>
          <a href={`/${slug}`} target="_blank" rel="noopener" className="font-semibold underline">View ↗</a>
          <button type="button" className="font-semibold text-red-600 underline" onClick={() => run(trashPageAction, `Move /${slug} to the trash? Its URL returns “not found” until restored.`)}>Trash</button>
        </>
      )}
    </div>
  );
}
