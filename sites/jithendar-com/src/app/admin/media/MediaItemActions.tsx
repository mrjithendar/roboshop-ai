"use client";

import { useState } from "react";

/** Inline alt-text editing and a delete button that warns when the file is still used. */
export function MediaItemActions({ id, alt, uses, back, saveAlt, remove }: {
  id: string;
  alt: string;
  uses: number;
  back: string;
  saveAlt: (form: FormData) => Promise<void>;
  remove: (form: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="mt-auto space-y-2 pt-1">
      <p className={uses > 0 ? "text-amber-700 dark:text-amber-300" : "text-slate-500"}>{uses > 0 ? `Used in ${uses} post(s)/page(s)` : "Not used anywhere"}</p>
      {editing ? (
        <form action={saveAlt} className="space-y-1">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="back" value={back} />
          <label className="sr-only" htmlFor={`alt-${id}`}>Alt text</label>
          <textarea id={`alt-${id}`} name="alt" defaultValue={alt} rows={2} maxLength={300} className="w-full rounded-lg border border-line-strong p-1.5 text-xs dark:bg-surface-dark" />
          <div className="flex gap-3"><button type="submit" className="font-semibold underline">Save</button><button type="button" className="underline" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="flex gap-3">
          <button type="button" className="min-h-6 font-semibold underline" onClick={() => setEditing(true)}>Edit alt text</button>
          <form action={remove} onSubmit={(e) => {
            const msg = uses > 0 ? `This file is used in ${uses} post(s)/page(s) and cannot be deleted until it is removed there.` : "Delete this file permanently from storage? This cannot be undone.";
            if (uses > 0) { e.preventDefault(); window.alert(msg); } else if (!window.confirm(msg)) e.preventDefault();
          }}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="min-h-6 text-red-600 underline">Delete permanently</button>
          </form>
        </div>
      )}
    </div>
  );
}
