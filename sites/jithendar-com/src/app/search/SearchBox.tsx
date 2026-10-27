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
        <label htmlFor={id} className="block text-sm font-medium">
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
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {status}
      </p>
      <ul className="mt-4 space-y-4">
        {results.map((r) => (
          <li key={r.path}>
            <Link href={r.path} className="font-semibold hover:underline">
              {r.title}
            </Link>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{r.description}</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {r.type} · {r.category}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
