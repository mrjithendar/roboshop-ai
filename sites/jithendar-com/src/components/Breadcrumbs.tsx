import Link from "next/link";
import type { Crumb } from "@/lib/seo/jsonld";

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-zinc-600 dark:text-zinc-400">
      <ol className="flex flex-wrap gap-1">
        {crumbs.map((crumb, i) => (
          <li key={crumb.path} className="flex gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {i === crumbs.length - 1 ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <Link href={crumb.path} className="hover:underline">
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
