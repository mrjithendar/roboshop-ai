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
            className="inline-flex min-h-8 items-center rounded-full border border-line bg-surface px-3 text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <span className="text-fg-subtle" aria-hidden="true">#</span>{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
