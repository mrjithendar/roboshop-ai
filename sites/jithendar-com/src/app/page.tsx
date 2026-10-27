import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArticleList, FeaturedArticle } from "@/components/ArticleList";
import { toneFor } from "@/components/categoryStyle";
import { Container } from "@/components/Container";
import {
  ArrowRight,
  CategoryIcon,
  CheckBadge,
  GitHubIcon,
  LinkedInIcon,
  LinkIcon,
  PencilIcon,
  RssIcon,
  SearchIcon,
  SparkIcon,
} from "@/components/icons";
import { JsonLd } from "@/components/JsonLd";
import { TopicGrid } from "@/components/TopicGrid";
import { site, siteUrl } from "@/config/site";
import { getCategories, getCategoryMap } from "@/lib/categories";
import { getSettings } from "@/lib/settings";
import { getAuthor, getPublishedContent } from "@/lib/content";
import { organizationLd, websiteLd } from "@/lib/seo/jsonld";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${site.name}: engineering insight on AI, cloud and Kubernetes` },
  alternates: { canonical: siteUrl() },
  openGraph: { type: "website", url: siteUrl(), siteName: site.name, locale: site.locale, title: site.name, description: site.description },
};

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 dark:bg-white dark:text-ink dark:hover:bg-slate-200";
const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-ink shadow-sm transition-colors hover:border-slate-400 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-white/30";

function SectionHeading({ id, eyebrow, title, description, action }: { id: string; eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">{eyebrow}</p>
        <h2 id={id} className="mt-2 text-3xl font-bold tracking-tight text-ink dark:text-white">
          {title}
        </h2>
        {description && <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">{description}</p>}
      </div>
      {action}
    </div>
  );
}

async function Hero() {
  const [cats, settings] = await Promise.all([getCategories().then((c) => c.slice(0, 8)), getSettings()]);
  const hero = settings.hero;
  return (
    <section className="relative overflow-hidden border-b border-slate-200 dark:border-white/10">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-400/25 via-accent-400/20 to-brand-300/25 blur-3xl dark:from-brand-600/25 dark:via-accent-500/15 dark:to-brand-500/20"
        aria-hidden="true"
      />
      <Container className="relative grid items-center gap-14 py-20 sm:py-24 lg:grid-cols-[1.25fr_1fr] lg:py-28">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            {hero.eyebrow}
          </p>
          <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-6xl dark:text-white">
            {hero.title} {hero.highlight && <span className="text-gradient">{hero.highlight}</span>}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600 dark:text-slate-300">
            {hero.subtitle}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="#topics" className={primaryButton}>
              Explore topics <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/about" className={secondaryButton}>
              About the publication
            </Link>
          </div>
        </div>

        {/* Decorative: the eight coverage areas as a tile mosaic. */}
        <div className="relative hidden lg:block" aria-hidden="true">
          <div className="grid grid-cols-2 gap-4 rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-xl shadow-brand-900/5 backdrop-blur dark:border-white/10 dark:bg-white/[0.04] dark:shadow-black/30">
            {cats.map((c, i) => {
              return (
                <div
                  key={c.slug}
                  className={`flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 dark:border-white/5 dark:bg-surface-dark-raised ${i % 2 ? "translate-y-3" : ""}`}
                >
                  <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${toneFor(c.tone)}`}>
                    <CategoryIcon name={c.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[13px] font-semibold leading-tight text-slate-700 dark:text-slate-200">{c.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}

async function Latest() {
  const all = await getPublishedContent();
  if (all.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-brand-50 via-white to-white p-8 sm:p-12 dark:border-white/10 dark:from-brand-900/30 dark:via-surface-dark-raised dark:to-surface-dark-raised">
        <div className="max-w-2xl">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm ring-1 ring-slate-200 dark:bg-white/10 dark:text-brand-300 dark:ring-white/10">
            <PencilIcon className="h-5 w-5" />
          </span>
          <h3 className="mt-6 text-2xl font-semibold tracking-tight text-ink dark:text-white">The first articles are in editorial review</h3>
          <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
            Articles are published only after a human editor has checked them against their sources. Subscribe to the feed to get
            them as soon as they go live.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="/feed.xml" className={primaryButton}>
              <RssIcon className="h-4 w-4" /> Subscribe via RSS
            </a>
            <Link href="/editorial-policy" className={secondaryButton}>
              Read the editorial policy
            </Link>
          </div>
        </div>
      </div>
    );
  }
  const [lead, ...rest] = all;
  const cats = await getCategoryMap();
  return (
    <div className="space-y-6">
      <FeaturedArticle article={lead!} cats={cats} />
      {rest.length > 0 && <ArticleList articles={rest.slice(0, 6)} emptyText="" headingLevel={3} />}
    </div>
  );
}

const principles = [
  {
    icon: CheckBadge,
    title: "Human-reviewed",
    text: "An editor reviews and approves every article before it is published.",
    href: "/editorial-policy",
    link: "Editorial policy",
  },
  {
    icon: LinkIcon,
    title: "Sourced",
    text: "News and summaries cite their sources, listed at the end of each article.",
    href: "/editorial-policy",
    link: "How we source",
  },
  {
    icon: PencilIcon,
    title: "Corrected in the open",
    text: "Errors are fixed promptly, with a dated note on the article.",
    href: "/corrections-policy",
    link: "Corrections policy",
  },
  {
    icon: SparkIcon,
    title: "Transparent about AI",
    text: "AI may assist with discovery and drafts. It never publishes on its own.",
    href: "/ai-use-policy",
    link: "AI use policy",
  },
];

function Principles() {
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {principles.map(({ icon: Icon, title, text, href, link }) => (
        <li key={title} className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-surface-dark-raised">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30">
            <Icon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 font-semibold text-ink dark:text-white">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{text}</p>
          <Link href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {link} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function AuthorBand() {
  const author = await getAuthor(site.primaryAuthor);
  if (!author) return null;
  return (
    <div className="grid items-center gap-8 rounded-3xl border border-slate-200 bg-slate-50 p-8 sm:p-10 lg:grid-cols-[auto_1fr_auto] dark:border-white/10 dark:bg-white/[0.03]">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-2xl font-bold text-white shadow-lg shadow-brand-900/10"
        aria-hidden="true"
      >
        JD
      </div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">Editor</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink dark:text-white">{author.frontmatter.name}</h2>
        <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">
          Writes and edits {site.name} and builds the systems behind it, including RoboShop AI, a public microservices storefront
          with an AI shopping assistant, deployed on Kubernetes.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
        <Link href={author.path} className={secondaryButton}>
          Author profile
        </Link>
        <a href="https://github.com/mrjithendar" rel="me noopener" className={secondaryButton}>
          <GitHubIcon className="h-4 w-4" /> GitHub
        </a>
        <a href="https://www.linkedin.com/in/jithendardharmapuri" rel="me noopener" className={secondaryButton}>
          <LinkedInIcon className="h-4 w-4" /> LinkedIn
        </a>
      </div>
    </div>
  );
}

function ClosingBand() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-ink px-8 py-14 text-center sm:px-16 dark:bg-gradient-to-br dark:from-brand-900 dark:to-surface-dark-raised">
      <div
        className="pointer-events-none absolute -bottom-32 left-1/2 h-64 w-[700px] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-500/40 to-accent-500/30 blur-3xl"
        aria-hidden="true"
      />
      <h2 className="relative text-3xl font-bold tracking-tight text-white">Stay ahead of what ships</h2>
      <p className="relative mx-auto mt-4 max-w-xl text-base leading-7 text-slate-300">
        Follow the RSS feed for every new article, or search the archive for the topic you are working on.
      </p>
      <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <a href="/feed.xml" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-slate-200">
          <RssIcon className="h-4 w-4 text-orange-500" /> RSS feed
        </a>
        <Link
          href="/search"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-white/40"
        >
          <SearchIcon className="h-4 w-4" /> Search articles
        </Link>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <JsonLd data={[websiteLd(), organizationLd()]} />
      <Hero />
      <Container className="space-y-24 py-20">
        <section aria-labelledby="latest" className="space-y-8">
          <SectionHeading
            id="latest"
            eyebrow="Latest"
            title="Recent articles"
            action={
              <Link href="/blog" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                All articles <ArrowRight className="h-4 w-4" />
              </Link>
            }
          />
          <Latest />
        </section>

        <section aria-labelledby="topics-heading" id="topics" className="scroll-mt-24 space-y-8">
          <SectionHeading
            id="topics-heading"
            eyebrow="Coverage"
            title="What we cover"
            description="Eight areas where engineering teams make the decisions that matter most right now."
          />
          <TopicGrid />
        </section>

        <section aria-labelledby="principles" className="space-y-8">
          <SectionHeading
            id="principles"
            eyebrow="Standards"
            title="How every article is made"
            description="The rules behind the publication, so you know what you can rely on."
          />
          <Principles />
        </section>

        <section aria-label="About the editor">
          <AuthorBand />
        </section>

        <section aria-label="Subscribe">
          <ClosingBand />
        </section>
      </Container>
    </>
  );
}
