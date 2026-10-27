import Link from "next/link";
import { tagSlug } from "@/config/taxonomy";

export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            href={`/tag/${tagSlug(tag)}`}
            className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-ink dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
