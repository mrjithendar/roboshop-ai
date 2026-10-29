"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

export function CopyLink({ url, className }: { url: string; className: string }) {
  const [status, setStatus] = useState("");
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setStatus("Link copied");
          } catch {
            setStatus("Copy failed");
          }
          setTimeout(() => setStatus(""), 2000);
        }}
      >
        {status === "Link copied" ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
        {status === "Link copied" ? "Copied" : "Copy link"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </>
  );
}
