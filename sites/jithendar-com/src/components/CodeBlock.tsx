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
        className="absolute right-2 top-2 rounded border border-zinc-300 bg-white/90 px-2 py-1 text-xs font-medium text-zinc-700 opacity-80 hover:opacity-100 focus-visible:opacity-100 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-200"
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
