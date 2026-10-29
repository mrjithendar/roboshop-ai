import Link from "next/link";
import { readingTimeMinutes, type Article } from "@/lib/content";
import { formatDate } from "@/lib/dates";
import { getCategoryMap, labelOf, type CategoryInfo } from "@/lib/categories";
import { getSiteConfig } from "@/lib/site-config";
import type { SiteConfig } from "@/lib/site-config/schema";
import { CoverImage } from "./CoverImage";
import { ContentTypeBadge, PreviewBadge, SponsoredBadge } from "./ContentTypeBadge";
import { ArrowRight, RssIcon } from "./icons";

export type CardDisplay = SiteConfig["blog"]["listing"];

/** Card presentation used when no configuration is passed (matches the default configuration). */
const DEFAULT_DISPLAY: CardDisplay = { layout: "grid", columns: 3, pageSize: 12, excerptLines: 3, coverAspect: "16/9", showDate: true, showReadingTime: true, showCategory: true, showType: true };

const CLAMP = ["", "line-clamp-1", "line-clamp-2", "line-clamp-3", "line-clamp-4"];

function Meta({ article, display }: { article: Article; display: CardDisplay }) {
  const fm = article.frontmatter;
  const parts = [
    display.showDate && <time key="d" dateTime={fm.publishedAt}>{formatDate(fm.publishedAt!)}</time>,
    display.showReadingTime && <span key="r">{readingTimeMinutes(article.body)} min read</span>,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-subtle">{parts.flatMap((p, i) => (i ? [<span key={`s${i}`} aria-hidden="true">·</span>, p] : [p]))}</p>;
}

type Cats = Map<string, CategoryInfo>;

function Kicker({ article, cats, display }: { article: Article; cats: Cats; display: CardDisplay }) {
  const fm = article.frontmatter;
  // Disclosures (sponsored, preview) always show, whatever the display options.
  if (!display.showCategory && !display.showType && !fm.sponsored && !article.preview) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {display.showCategory && <span className="text-sm font-medium text-accent-text">{labelOf(cats, fm.category)}</span>}
      {display.showType && <ContentTypeBadge type={fm.contentType} />}
      {fm.sponsored && <SponsoredBadge />}
      {article.preview && <PreviewBadge />}
    </div>
  );
}

/** Whole card is one link target (title link stretched), keeping a single accessible name. */
export function ArticleCard({ article, cats, headingLevel = 2, display = DEFAULT_DISPLAY }: { article: Article; cats: Cats; headingLevel?: 2 | 3; display?: CardDisplay }) {
  const fm = article.frontmatter;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  if (display.layout === "list") return <ArticleRow article={article} cats={cats} Heading={Heading} display={display} />;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-line-strong">
      {display.coverAspect !== "none" && (
        <CoverImage article={article} category={cats.get(fm.category)} aspect={display.coverAspect} sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw" className="border-b border-line" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <Kicker article={article} cats={cats} display={display} />
        <div className="flex-1">
          <Heading className="text-lg font-semibold leading-snug tracking-tight text-fg [overflow-wrap:anywhere]">
            <Link href={article.path} className="after:absolute after:inset-0 after:rounded-xl group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4 focus-visible:outline-none group-has-[:focus-visible]:underline">
              {fm.title}
            </Link>
          </Heading>
          {display.excerptLines > 0 && <p className={`mt-2 ${CLAMP[display.excerptLines]} text-[0.9375rem] leading-6 text-fg-muted`}>{fm.description}</p>}
        </div>
        <Meta article={article} display={display} />
      </div>
    </article>
  );
}

/** List layout: a compact row with a small cover beside the text (stacked on phones). */
function ArticleRow({ article, cats, Heading, display }: { article: Article; cats: Cats; Heading: "h2" | "h3"; display: CardDisplay }) {
  const fm = article.frontmatter;
  return (
    <article className="group relative grid gap-4 border-b border-line py-6 first:pt-0 sm:grid-cols-[minmax(0,1fr)_12rem] sm:gap-6">
      <div className="min-w-0 space-y-2.5">
        <Kicker article={article} cats={cats} display={display} />
        <Heading className="text-xl font-semibold leading-snug tracking-tight text-fg [overflow-wrap:anywhere]">
          <Link href={article.path} className="after:absolute after:inset-0 group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4 focus-visible:outline-none group-has-[:focus-visible]:underline">
            {fm.title}
          </Link>
        </Heading>
        {display.excerptLines > 0 && <p className={`${CLAMP[display.excerptLines]} text-[0.9375rem] leading-6 text-fg-muted`}>{fm.description}</p>}
        <Meta article={article} display={display} />
      </div>
      {display.coverAspect !== "none" && (
        <CoverImage article={article} category={cats.get(fm.category)} aspect={display.coverAspect} sizes="(min-width: 640px) 192px, 100vw" className="order-first rounded-lg border border-line sm:order-none" />
      )}
    </article>
  );
}

/** Lead story: cover beside the text on large screens, stacked on phones. */
export function FeaturedArticle({ article, cats, headingLevel = 3, display = DEFAULT_DISPLAY }: { article: Article; cats: Cats; headingLevel?: 2 | 3; display?: CardDisplay }) {
  const fm = article.frontmatter;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="group relative grid overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-line-strong lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <CoverImage
        article={article}
        category={cats.get(fm.category)}
        sizes="(min-width: 1024px) 640px, 100vw"
        priority
        aspect={display.coverAspect === "none" ? "16/9" : display.coverAspect}
        className="border-b border-line lg:aspect-auto! lg:h-full lg:min-h-[320px] lg:border-b-0 lg:border-r"
      />
      <div className="flex flex-col p-6 sm:p-8">
        <Kicker article={article} cats={cats} display={display} />
        <Heading className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-[1.75rem] [overflow-wrap:anywhere]">
          <Link href={article.path} className="after:absolute after:inset-0 after:rounded-xl group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4 focus-visible:outline-none group-has-[:focus-visible]:underline">
            {fm.title}
          </Link>
        </Heading>
        <p className="mt-3 text-base leading-7 text-fg-muted">{fm.description}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
          <Meta article={article} display={display} />
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text" aria-hidden="true">
            Read article <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </article>
  );
}

/** Grid or list of cards, presented as configured in Admin → Appearance → Blog (overridable per use). */
export async function ArticleList({
  articles,
  emptyText,
  headingLevel = 2,
  layout,
}: {
  articles: Article[];
  emptyText: string;
  headingLevel?: 2 | 3;
  layout?: "grid" | "list";
}) {
  if (articles.length === 0) return <EmptyState text={emptyText} />;
  const [cats, { config }] = await Promise.all([getCategoryMap(), getSiteConfig()]);
  const display = { ...config.blog.listing, ...(layout ? { layout } : {}) };
  if (display.layout === "list") {
    return (
      <ul>
        {articles.map((a) => (
          <li key={a.path}>
            <ArticleCard article={a} cats={cats} headingLevel={headingLevel} display={display} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={`grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:gap-6 ${display.columns === 3 ? "lg:grid-cols-3" : ""}`}>
      {articles.map((a) => (
        <li key={a.path}>
          <ArticleCard article={a} cats={cats} headingLevel={headingLevel} display={display} />
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="text-base font-semibold text-fg">{text}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-muted">New articles appear here as soon as they are published.</p>
      <a href="/feed.xml" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent-text hover:underline">
        <RssIcon className="h-4 w-4" /> Follow the RSS feed
      </a>
    </div>
  );
}
