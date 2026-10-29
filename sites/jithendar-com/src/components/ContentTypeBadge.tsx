import { contentTypes, type ContentType } from "@/config/taxonomy";

// Neutral pills with a coloured dot: readers can still tell news from opinion at a glance without
// a rainbow of fills. Disclosures (sponsored, preview) keep a full tint because they must stand out.
const dots: Record<ContentType, string> = {
  news: "bg-red-500",
  analysis: "bg-violet-500",
  tutorial: "bg-emerald-500",
  opinion: "bg-amber-500",
  curated: "bg-sky-500",
  project: "bg-slate-400",
};

const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";

export function ContentTypeBadge({ type }: { type: ContentType }) {
  return (
    <span className={`${base} bg-surface text-fg-muted ring-line`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[type]}`} aria-hidden="true" />
      {contentTypes[type]}
    </span>
  );
}

export function SponsoredBadge() {
  return <span className={`${base} bg-yellow-50 font-semibold text-yellow-900 ring-yellow-600/30 dark:bg-yellow-500/10 dark:text-yellow-200 dark:ring-yellow-400/30`}>Sponsored</span>;
}

export function PreviewBadge() {
  return <span className={`${base} border border-dashed border-amber-500 bg-amber-50 font-semibold text-amber-900 ring-0 dark:bg-amber-500/10 dark:text-amber-200`}>Preview: not published</span>;
}
