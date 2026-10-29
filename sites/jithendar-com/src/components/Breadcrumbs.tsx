import Link from "next/link";
import type { Crumb } from "@/lib/seo/jsonld";

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-fg-subtle">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((crumb, i) => (
          <li key={crumb.path} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-fg-subtle opacity-70" aria-hidden="true">
                <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="line-clamp-1 font-medium text-fg-muted [overflow-wrap:anywhere]">
                {crumb.name}
              </span>
            ) : (
              <Link href={crumb.path} className="inline-flex min-h-6 items-center transition-colors hover:text-fg hover:underline">
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
