import Link from "next/link";

export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}/page/${page}`;
}

export function Pagination({ basePath, page, totalPages }: { basePath: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={pageHref(basePath, page - 1)} rel="prev" className="underline">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span aria-current="page">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={pageHref(basePath, page + 1)} rel="next" className="underline">
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
