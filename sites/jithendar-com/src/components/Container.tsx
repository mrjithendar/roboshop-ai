import type { ReactNode } from "react";

/** Standard page gutter and max width. `narrow` is the reading width for articles and policies. */
export function Container({ children, narrow = false, className = "" }: { children: ReactNode; narrow?: boolean; className?: string }) {
  return <div className={`mx-auto w-full px-5 sm:px-8 ${narrow ? "max-w-3xl" : "max-w-6xl"} ${className}`}>{children}</div>;
}
