import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArticleList, FeaturedArticle } from "@/components/ArticleList";
import { Container } from "@/components/Container";
import { ArrowRight, CheckBadge, GitHubIcon, LinkedInIcon, LinkIcon, PencilIcon, RssIcon, SparkIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui/form";
import { UserAvatar } from "@/components/UserAvatar";
import { JsonLd } from "@/components/JsonLd";
import { TopicGrid } from "@/components/TopicGrid";
import { site, siteUrl } from "@/config/site";
import { getCategoryMap } from "@/lib/categories";
import { getSettings } from "@/lib/settings";
import { getAuthor, getPublishedContent, type Article } from "@/lib/content";
import { organizationLd, websiteLd } from "@/lib/seo/jsonld";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${site.name}: engineering insight on AI, cloud and Kubernetes` },
  alternates: { canonical: siteUrl() },
  openGraph: { type: "website", url: siteUrl(), siteName: site.name, locale: site.locale, title: site.name, description: site.description },
};

function SectionHeading({ id, title, description, action }: { id: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="max-w-2xl">
        <h2 id={id} className="text-heading font-semibold text-fg">
          {title}
        </h2>
        {description && <p className="mt-2 text-base leading-7 text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline">
      {children} <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

async function Intro() {
  const hero = (await getSettings()).hero;
  return (
    <section aria-labelledby="intro-title" className="border-b border-line">
      <Container className="py-14 sm:py-20 lg:py-24">
        <div className="max-w-3xl">
          {hero.eyebrow && <p className="eyebrow">{hero.eyebrow}</p>}
          <h1 id="intro-title" className="mt-4 text-display font-bold text-fg text-balance">
            {hero.title} {hero.highlight && <span className="text-accent-text">{hero.highlight}</span>}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-fg-muted">{hero.subtitle}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/blog" className={buttonClass("primary", "lg")}>
              Read the latest articles <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/about" className={buttonClass("secondary", "lg")}>
              About the publication
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

async function Latest({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface-muted p-6 sm:p-10">
        <div className="max-w-2xl">
          <PencilIcon className="h-6 w-6 text-accent-text" />
          <h3 className="mt-4 text-xl font-semibold tracking-tight text-fg">The first articles are in editorial review</h3>
          <p className="mt-2 text-base leading-7 text-fg-muted">
            Articles are published only after a human editor has checked them against their sources. Subscribe to the feed to get
            them as soon as they go live.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a href="/feed.xml" className={buttonClass("primary")}>
              <RssIcon className="h-4 w-4" /> Subscribe via RSS
            </a>
            <Link href="/editorial-policy" className={buttonClass("secondary")}>
              Read the editorial policy
            </Link>
          </div>
        </div>
      </div>
    );
  }
  const [lead, ...rest] = articles;
  const cats = await getCategoryMap();
  return (
    <div className="space-y-5 lg:space-y-6">
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
    <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
      {principles.map(({ icon: Icon, title, text, href, link }) => (
        <li key={title} className="border-t border-line pt-5">
          <Icon className="h-5 w-5 text-accent-text" />
          <h3 className="mt-3 text-base font-semibold text-fg">{title}</h3>
          <p className="mt-1.5 text-[0.9375rem] leading-6 text-fg-muted">{text}</p>
          <Link href={href} className="mt-3 inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-accent-text hover:underline">
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
    <div className="grid gap-6 rounded-xl border border-line bg-surface-muted p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-8 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
      <UserAvatar name={author.frontmatter.name} size="lg" />
      <div>
        <p className="eyebrow">Editor</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-fg">{author.frontmatter.name}</h2>
        <p className="mt-2 max-w-2xl text-base leading-7 text-fg-muted">
          Writes and edits {site.name} and builds the systems behind it, including RoboShop AI, a public microservices storefront
          with an AI shopping assistant, deployed on Kubernetes.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1 lg:flex-col">
        <Link href={author.path} className={buttonClass("secondary")}>
          Author profile
        </Link>
        <a href="https://github.com/mrjithendar" rel="me noopener" className={buttonClass("secondary")}>
          <GitHubIcon className="h-4 w-4" /> GitHub
        </a>
        <a href="https://www.linkedin.com/in/jithendardharmapuri" rel="me noopener" className={buttonClass("secondary")}>
          <LinkedInIcon className="h-4 w-4" /> LinkedIn
        </a>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const all = await getPublishedContent();
  const projects = all.filter((a) => a.collection === "projects");
  const writing = all.filter((a) => a.collection !== "projects");
  return (
    <>
      <JsonLd data={[websiteLd(), organizationLd()]} />
      <Intro />
      <Container className="space-y-section pt-section">
        <section aria-labelledby="latest" className="space-y-6">
          <SectionHeading id="latest" title="Latest writing" action={writing.length > 0 && <SectionLink href="/blog">All articles</SectionLink>} />
          <Latest articles={writing} />
        </section>

        <section aria-labelledby="topics-heading" id="topics" className="space-y-6">
          <SectionHeading
            id="topics-heading"
            title="Topics"
            description="Eight areas where engineering teams make the decisions that matter most right now."
          />
          <TopicGrid />
        </section>

        {projects.length > 0 && (
          <section aria-labelledby="projects-heading" className="space-y-6">
            <SectionHeading
              id="projects-heading"
              title="Projects"
              description="Systems the editor has built, and how they work."
              action={<SectionLink href="/projects">All projects</SectionLink>}
            />
            <ArticleList articles={projects.slice(0, 3)} emptyText="" headingLevel={3} />
          </section>
        )}

        <section aria-labelledby="principles" className="space-y-6">
          <SectionHeading id="principles" title="How every article is made" description="The rules behind the publication, so you know what you can rely on." />
          <Principles />
        </section>

        <section aria-label="About the editor">
          <AuthorBand />
        </section>
      </Container>
    </>
  );
}
