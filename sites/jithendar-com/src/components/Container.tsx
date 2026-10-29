import type { ReactNode } from "react";

/** Shared page shell: one gutter scale (16 → 24 → 32px) and two widths — `page` (1216px) and `narrow`, the reading column. */
export function Container({ children, narrow = false, className = "" }: { children: ReactNode; narrow?: boolean; className?: string }) {
  return <div className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${narrow ? "max-w-[calc(var(--container-reading)+4rem)]" : "max-w-[calc(var(--container-page)+4rem)]"} ${className}`}>{children}</div>;
}
