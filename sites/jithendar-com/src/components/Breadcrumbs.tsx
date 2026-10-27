import Link from "next/link";
import type { Crumb } from "@/lib/seo/jsonld";

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-slate-500 dark:text-slate-400">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((crumb, i) => (
          <li key={crumb.path} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true">
                <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-slate-700 dark:text-slate-200">
                {crumb.name}
              </span>
            ) : (
              <Link href={crumb.path} className="transition-colors hover:text-ink dark:hover:text-white">
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
