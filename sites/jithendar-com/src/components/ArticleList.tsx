import Link from "next/link";
import { readingTimeMinutes, type Article } from "@/lib/content";
import { formatDate } from "@/lib/dates";
import { getCategoryMap, labelOf, type CategoryInfo } from "@/lib/categories";
import { toneFor } from "./categoryStyle";
import { ContentTypeBadge, PreviewBadge, SponsoredBadge } from "./ContentTypeBadge";
import { ArrowRight, CategoryIcon } from "./icons";

function Meta({ article }: { article: Article }) {
  const fm = article.frontmatter;
  return (
    <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <time dateTime={fm.publishedAt}>{formatDate(fm.publishedAt!)}</time>
      <span aria-hidden="true">·</span>
      <span>{readingTimeMinutes(article.body)} min read</span>
    </p>
  );
}

type Cats = Map<string, CategoryInfo>;

function Badges({ article, cats }: { article: Article; cats: Cats }) {
  const fm = article.frontmatter;
  const info = cats.get(fm.category);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset ${toneFor(info?.tone ?? "slate")}`}>
        <CategoryIcon name={info?.icon ?? "layers"} className="h-4 w-4" />
      </span>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{labelOf(cats, fm.category)}</span>
      <ContentTypeBadge type={fm.contentType} />
      {fm.sponsored && <SponsoredBadge />}
      {article.preview && <PreviewBadge />}
    </div>
  );
}

/** Whole card is one link target (title link stretched), keeping a single accessible name. */
export function ArticleCard({ article, cats, headingLevel = 2 }: { article: Article; cats: Cats; headingLevel?: 2 | 3 }) {
  const fm = article.frontmatter;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="group relative flex h-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-white/10 dark:bg-surface-dark-raised dark:hover:border-white/20">
      <Badges article={article} cats={cats} />
      <div className="flex-1">
        <Heading className="text-lg font-semibold leading-snug tracking-tight text-ink dark:text-white">
          <Link href={article.path} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none group-focus-within:underline">
            {fm.title}
          </Link>
        </Heading>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{fm.description}</p>
      </div>
      <div className="flex items-center justify-between">
        <Meta article={article} />
        <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600 dark:group-hover:text-brand-300" />
      </div>
    </article>
  );
}

/** Large lead card for the newest item. */
export function FeaturedArticle({ article, cats }: { article: Article; cats: Cats }) {
  const fm = article.frontmatter;
  return (
    <article className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-brand-50 via-white to-white p-8 shadow-sm transition-shadow hover:shadow-md sm:p-10 dark:border-white/10 dark:from-brand-900/40 dark:via-surface-dark-raised dark:to-surface-dark-raised">
      <Badges article={article} cats={cats} />
      <h3 className="mt-6 max-w-3xl text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl dark:text-white">
        <Link href={article.path} className="after:absolute after:inset-0 focus-visible:outline-none group-focus-within:underline">
          {fm.title}
        </Link>
      </h3>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">{fm.description}</p>
      <div className="mt-8 flex items-center justify-between">
        <Meta article={article} />
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300">
          Read article <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  );
}

export async function ArticleList({
  articles,
  emptyText,
  headingLevel = 2,
  columns = 3,
}: {
  articles: Article[];
  emptyText: string;
  headingLevel?: 2 | 3;
  columns?: 2 | 3;
}) {
  if (articles.length === 0) return <EmptyState text={emptyText} />;
  const cats = await getCategoryMap();
  return (
    <ul className={`grid gap-6 sm:grid-cols-2 ${columns === 3 ? "lg:grid-cols-3" : ""}`}>
      {articles.map((a) => (
        <li key={a.path}>
          <ArticleCard article={a} cats={cats} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-14 text-center dark:border-white/15 dark:bg-white/[0.02]">
      <p className="text-base font-medium text-ink dark:text-white">{text}</p>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        New articles appear here as soon as they are published.{" "}
        <a href="/feed.xml" className="font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300">
          Follow the RSS feed
        </a>{" "}
        to be notified.
      </p>
    </div>
  );
}
