import Link from "next/link";

export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}/page/${page}`;
}

const button =
  "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition-colors hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20";

export function Pagination({ basePath, page, totalPages }: { basePath: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-between border-t border-slate-200 pt-8 text-sm dark:border-white/10">
      {page > 1 ? (
        <Link href={pageHref(basePath, page - 1)} rel="prev" className={button}>
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span aria-current="page" className="text-slate-500 dark:text-slate-400">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={pageHref(basePath, page + 1)} rel="next" className={button}>
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
