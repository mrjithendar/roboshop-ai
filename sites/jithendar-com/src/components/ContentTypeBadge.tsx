import { contentTypes, type ContentType } from "@/config/taxonomy";

// Distinct colour per type so readers can tell news from opinion at a glance (AA contrast in both themes).
const styles: Record<ContentType | "sponsored" | "preview", string> = {
  news: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30",
  analysis: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/30",
  tutorial: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  opinion: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  curated: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/30",
  project: "bg-slate-100 text-slate-700 ring-slate-600/20 dark:bg-white/10 dark:text-slate-200 dark:ring-white/20",
  sponsored: "bg-yellow-50 text-yellow-800 ring-yellow-600/30 dark:bg-yellow-500/10 dark:text-yellow-300 dark:ring-yellow-400/30",
  preview: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/30 ring-dashed dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
};

const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset";

export function ContentTypeBadge({ type }: { type: ContentType }) {
  return <span className={`${base} ${styles[type]}`}>{contentTypes[type]}</span>;
}

export function SponsoredBadge() {
  return <span className={`${base} ${styles.sponsored}`}>Sponsored</span>;
}

export function PreviewBadge() {
  return <span className={`${base} ${styles.preview}`}>Preview: not published</span>;
}
