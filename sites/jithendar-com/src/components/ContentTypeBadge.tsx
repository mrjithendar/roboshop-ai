import { contentTypes, type ContentType } from "@/config/taxonomy";

// Distinct colour per type so readers can tell news from opinion at a glance (AA contrast in both themes).
const styles: Record<ContentType | "sponsored" | "preview", string> = {
  news: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  analysis: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  tutorial: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  opinion: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  curated: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  project: "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
  sponsored: "border border-yellow-500 bg-yellow-50 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
  preview: "border border-dashed border-fuchsia-500 text-fuchsia-800 dark:text-fuchsia-300",
};

const base = "inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide";

export function ContentTypeBadge({ type }: { type: ContentType }) {
  return <span className={`${base} ${styles[type]}`}>{contentTypes[type]}</span>;
}

export function SponsoredBadge() {
  return <span className={`${base} ${styles.sponsored}`}>Sponsored</span>;
}

export function PreviewBadge() {
  return <span className={`${base} ${styles.preview}`}>Preview: not published</span>;
}
