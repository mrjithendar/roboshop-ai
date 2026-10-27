import Link from "next/link";
import { categories } from "@/config/taxonomy";
import { readingTimeMinutes, type Article } from "@/lib/content";
import { formatDate } from "@/lib/dates";
import { ContentTypeBadge, PreviewBadge, SponsoredBadge } from "./ContentTypeBadge";

export function ArticleCard({ article, headingLevel = 2 }: { article: Article; headingLevel?: 2 | 3 }) {
  const fm = article.frontmatter;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600">
      <div className="flex flex-wrap items-center gap-2">
        <ContentTypeBadge type={fm.contentType} />
        {fm.sponsored && <SponsoredBadge />}
        {article.preview && <PreviewBadge />}
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{categories[fm.category]}</span>
      </div>
      <Heading className="text-lg font-semibold leading-snug">
        <Link href={article.path} className="hover:underline">
          {fm.title}
        </Link>
      </Heading>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{fm.description}</p>
      <p className="mt-auto text-xs text-zinc-600 dark:text-zinc-400">
        <time dateTime={fm.publishedAt}>{formatDate(fm.publishedAt!)}</time> · {readingTimeMinutes(article.body)} min read
      </p>
    </article>
  );
}

export function ArticleList({
  articles,
  emptyText,
  headingLevel = 2,
}: {
  articles: Article[];
  emptyText: string;
  headingLevel?: 2 | 3;
}) {
  if (articles.length === 0) return <p className="text-zinc-600 dark:text-zinc-400">{emptyText}</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {articles.map((a) => (
        <li key={a.path} className="flex">
          <ArticleCard article={a} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
