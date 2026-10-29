"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { searchEntries, type SearchEntry } from "@/lib/seo/search-index";

/** Client search over a prebuilt JSON index; the index is fetched only once the reader starts typing. */
export function SearchBox() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [error, setError] = useState(false);
  const loading = useRef(false);

  function load() {
    if (index || loading.current) return;
    loading.current = true;
    fetch("/search-index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: SearchEntry[]) => setIndex(data))
      .catch(() => setError(true));
  }

  const results = index ? searchEntries(index, query) : [];
  const status = error
    ? "Search is unavailable right now."
    : !query.trim()
      ? ""
      : !index
        ? "Loading…"
        : `${results.length} result${results.length === 1 ? "" : "s"}`;

  return (
    <div>
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={id} className="block text-sm font-medium text-fg">
          Search articles
        </label>
        <input
          id={id}
          type="search"
          value={query}
          onFocus={load}
          onChange={(e) => {
            setQuery(e.target.value);
            load();
          }}
          placeholder="e.g. argo cd, terraform, mcp"
          autoComplete="off"
          className="mt-2 w-full rounded-xl border border-line-strong bg-surface px-4 py-3.5 text-base text-fg shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
        />
      </form>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-fg-subtle">
        {status}
      </p>
      <ul className="mt-6 space-y-3">
        {results.map((r) => (
          <li key={r.path} className="rounded-xl border border-line p-5 transition-colors hover:border-slate-300 dark:hover:border-white/20">
            <p className="text-xs font-medium text-fg-subtle">
              {r.type} · {r.category}
            </p>
            <Link href={r.path} className="mt-1 block font-semibold text-fg hover:underline">
              {r.title}
            </Link>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{r.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
