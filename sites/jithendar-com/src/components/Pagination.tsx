import Link from "next/link";
import { buttonClass } from "./ui/form";
import { ArrowLeft, ArrowRight } from "./icons";

export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}/page/${page}`;
}

export function Pagination({ basePath, page, totalPages }: { basePath: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-12 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line pt-6 text-sm">
      <div>
        {page > 1 && (
          <Link href={pageHref(basePath, page - 1)} rel="prev" className={buttonClass("secondary")}>
            <ArrowLeft className="h-4 w-4" /> Newer
          </Link>
        )}
      </div>
      <span aria-current="page" className="text-fg-subtle">
        Page {page} of {totalPages}
      </span>
      <div className="text-right">
        {page < totalPages && (
          <Link href={pageHref(basePath, page + 1)} rel="next" className={buttonClass("secondary")}>
            Older <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </nav>
  );
}
