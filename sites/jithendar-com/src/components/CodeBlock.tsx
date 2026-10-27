"use client";

import { useRef, useState, type ComponentProps } from "react";

/** Highlighted <pre> with a keyboard-accessible copy button and a screen-reader announcement. */
export function CodeBlock(props: ComponentProps<"pre">) {
  const pre = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(pre.current?.textContent ?? "");
      setStatus("Copied to clipboard");
    } catch {
      setStatus("Copy failed");
    }
    setTimeout(() => setStatus(""), 2000);
  }

  return (
    <div className="group relative">
      <pre ref={pre} {...props} />
      <button
        type="button"
        onClick={copy}
        className="absolute right-3 top-3 rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1 font-sans text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:border-white/15 dark:bg-surface-dark-raised/90 dark:text-slate-200"
      >
        {status === "Copied to clipboard" ? "Copied" : "Copy"}
        <span className="sr-only"> code</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}
