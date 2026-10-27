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
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:border-zinc-500 dark:border-zinc-700"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
