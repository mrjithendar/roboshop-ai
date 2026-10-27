import Link from "next/link";
import { contentTypes } from "@/config/taxonomy";
import type { Article } from "@/lib/content";
import { formatDateTime } from "@/lib/dates";

export function ArticleList({ articles, emptyText }: { articles: Article[]; emptyText: string }) {
  if (articles.length === 0) return <p className="text-zinc-600 dark:text-zinc-400">{emptyText}</p>;
  return (
    <ul className="space-y-8">
      {articles.map((a) => (
        <li key={a.path}>
          <article>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {contentTypes[a.frontmatter.contentType]} ·{" "}
              <time dateTime={a.frontmatter.publishedAt}>{formatDateTime(a.frontmatter.publishedAt!)}</time>
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              <Link href={a.path} className="hover:underline">
                {a.frontmatter.title}
              </Link>
            </h2>
            <p className="mt-1 text-zinc-700 dark:text-zinc-300">{a.frontmatter.description}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}
