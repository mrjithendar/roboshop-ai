import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArticleList, FeaturedArticle } from "@/components/ArticleList";
import { Container } from "@/components/Container";
import { ArrowRight, CheckBadge, GitHubIcon, LinkedInIcon, LinkIcon, PencilIcon, RssIcon, SparkIcon } from "@/components/icons";
import { BannerBackground } from "@/components/site/BannerBackground";
import { TopicGrid } from "@/components/TopicGrid";
import { buttonClass } from "@/components/ui/form";
import { UserAvatar } from "@/components/UserAvatar";
import { getCategoryMap } from "@/lib/categories";
import { getAuthor, getPublishedContent, type Article } from "@/lib/content";
import { SECTION_TYPES, type Section, type SiteConfig } from "@/lib/site-config/schema";

type Of<T extends Section["type"]> = Extract<Section, { type: T }>;
type Ctx = { config: SiteConfig; articles: Article[] };

const PAD = { sm: "py-8 sm:py-10", md: "py-12 sm:py-16", lg: "py-16 sm:py-24" };
const BG = { none: "", muted: "bg-surface-muted border-y border-line", accent: "bg-accent-soft border-y border-line" };

function Shell({ s, label, children, bleed = false }: { s: Section; label: string; children: ReactNode; bleed?: boolean }) {
  return (
    <section
      {...(label ? { "aria-labelledby": `${s.id}-title` } : { "aria-label": SECTION_TYPES[s.type] })}
      className={`relative isolate ${PAD[s.spacing]} ${BG[s.background]}`}
    >
      {bleed ? children : <Container>{children}</Container>}
    </section>
  );
}

function Heading({ s, title, description, action }: { s: Section; title: string; description?: string; action?: ReactNode }) {
  if (!title && !description && !action) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="max-w-2xl">
        {title && (
          <h2 id={`${s.id}-title`} className="text-heading font-semibold text-fg">
            {title}
          </h2>
        )}
        {description && <p className="mt-2 text-base leading-7 text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline">
      {children} <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

/** A configured link: internal paths use client navigation; https links are external. */
function ButtonLink({ href, label, variant }: { href: string; label: string; variant: "primary" | "secondary" }) {
  if (!href || !label) return null;
  const cls = buttonClass(variant, "lg");
  return href.startsWith("/") && !href.endsWith(".xml") ? (
    <Link href={href} className={cls}>
      {label} {variant === "primary" && <ArrowRight className="h-4 w-4" />}
    </Link>
  ) : (
    <a href={href} className={cls} rel={href.startsWith("/") ? undefined : "noopener"}>
      {href.endsWith(".xml") && <RssIcon className="h-4 w-4" />}
      {label}
    </a>
  );
}

const HERO_HEIGHT = { sm: "min-h-[18rem]", md: "min-h-[24rem] sm:min-h-[28rem]", lg: "min-h-[28rem] sm:min-h-[36rem]" };

function Hero({ s }: { s: Of<"hero"> }) {
  const banner = s.layout === "banner" && !!s.image.desktop;
  const split = s.layout === "split" && !!s.image.desktop;
  const center = s.align === "center" && !split;
  const text = (
    <div className={`max-w-3xl ${center ? "mx-auto text-center" : ""}`}>
      {s.eyebrow && <p className="eyebrow">{s.eyebrow}</p>}
      <h1 id={`${s.id}-title`} className={`text-display font-bold text-fg text-balance ${s.eyebrow ? "mt-4" : ""}`}>
        {s.heading} {s.highlight && <span className="text-accent-text">{s.highlight}</span>}
      </h1>
      {s.subtitle && <p className={`mt-5 max-w-2xl text-lg leading-8 text-fg-muted ${center ? "mx-auto" : ""}`}>{s.subtitle}</p>}
      {(s.primary.href || s.secondary.href) && (
        <div className={`mt-8 flex flex-col gap-3 sm:flex-row ${center ? "sm:justify-center" : ""}`}>
          <ButtonLink href={s.primary.href} label={s.primary.label} variant="primary" />
          <ButtonLink href={s.secondary.href} label={s.secondary.label} variant="secondary" />
        </div>
      )}
    </div>
  );
  return (
    <section
      aria-labelledby={`${s.id}-title`}
      className={`relative isolate border-b border-line ${banner ? `chrome-inverse flex items-center ${HERO_HEIGHT[s.image.height]}` : ""} ${PAD[s.spacing]} ${BG[s.background]}`}
      style={banner ? ({ "--chrome-ink": "#ffffff", "--chrome-ink-contrast": "#111317" } as React.CSSProperties) : undefined}
    >
      {banner && <BannerBackground banner={s.image} priority />}
      <Container>
        {split ? (
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {text}
            <Image
              src={s.image.desktop!.src}
              alt={s.image.desktop!.decorative ? "" : s.image.desktop!.alt}
              width={s.image.desktop!.width}
              height={s.image.desktop!.height}
              sizes="(min-width: 1024px) 560px, 100vw"
              loading="eager"
              fetchPriority="high"
              className={`h-auto w-full rounded-xl border border-line ${s.image.desktop!.fit === "contain" ? "object-contain" : "object-cover"}`}
              style={{ objectPosition: `${s.image.desktop!.focalX}% ${s.image.desktop!.focalY}%` }}
            />
          </div>
        ) : (
          text
        )}
      </Container>
    </section>
  );
}

async function Latest({ s, ctx }: { s: Of<"latest">; ctx: Ctx }) {
  const items = ctx.articles.filter((a) => s.collections.includes(a.collection)).slice(0, s.count);
  const onlyBlog = s.collections.length === 1 ? `/${s.collections[0]}` : "/blog";
  return (
    <Shell s={s} label={s.heading}>
      <Heading s={s} title={s.heading} description={s.description} action={s.showViewAll && items.length > 0 ? <MoreLink href={onlyBlog}>View all</MoreLink> : undefined} />
      {items.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-muted p-6 sm:p-10">
          <div className="max-w-2xl">
            <PencilIcon className="h-6 w-6 text-accent-text" />
            <h3 className="mt-4 text-xl font-semibold tracking-tight text-fg">The first articles are in editorial review</h3>
            <p className="mt-2 text-base leading-7 text-fg-muted">
              Articles are published only after a human editor has checked them against their sources. Subscribe to the feed to get them as soon as they go live.
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
      ) : s.layout === "featured-grid" ? (
        <div className="space-y-5 lg:space-y-6">
          <FeaturedArticle article={items[0]!} cats={await getCategoryMap()} display={ctx.config.blog.listing} />
          {items.length > 1 && <ArticleList articles={items.slice(1)} emptyText="" headingLevel={3} layout="grid" />}
        </div>
      ) : (
        <ArticleList articles={items} emptyText="" headingLevel={3} layout={s.layout} />
      )}
    </Shell>
  );
}

function Featured({ s, ctx }: { s: Of<"featured">; ctx: Ctx }) {
  // Only published articles: a picked article that is unpublished or deleted simply drops out.
  const byPath = new Map(ctx.articles.map((a) => [a.path, a]));
  const items = s.paths.map((p) => byPath.get(p)).filter((a): a is Article => !!a);
  if (items.length === 0) return null;
  return (
    <Shell s={s} label={s.heading}>
      <Heading s={s} title={s.heading} description={s.description} />
      <ArticleList articles={items} emptyText="" headingLevel={3} layout={s.layout} />
    </Shell>
  );
}

function Topics({ s }: { s: Of<"topics"> }) {
  return (
    <Shell s={s} label={s.heading}>
      <Heading s={s} title={s.heading} description={s.description} />
      <TopicGrid only={s.categories} layout={s.layout} />
    </Shell>
  );
}

function Projects({ s, ctx }: { s: Of<"projects">; ctx: Ctx }) {
  const items = ctx.articles.filter((a) => a.collection === "projects").slice(0, s.count);
  if (items.length === 0) return null;
  return (
    <Shell s={s} label={s.heading}>
      <Heading s={s} title={s.heading} description={s.description} action={<MoreLink href="/projects">All projects</MoreLink>} />
      <ArticleList articles={items} emptyText="" headingLevel={3} />
    </Shell>
  );
}

const PRINCIPLE_ICONS = [CheckBadge, LinkIcon, PencilIcon, SparkIcon];

function Principles({ s }: { s: Of<"principles"> }) {
  return (
    <Shell s={s} label={s.heading}>
      <Heading s={s} title={s.heading} description={s.description} />
      <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {s.items.map((item, i) => {
          const Icon = PRINCIPLE_ICONS[i % PRINCIPLE_ICONS.length]!;
          return (
            <li key={item.title} className="border-t border-line pt-5">
              <Icon className="h-5 w-5 text-accent-text" />
              <h3 className="mt-3 text-base font-semibold text-fg">{item.title}</h3>
              {item.text && <p className="mt-1.5 text-[0.9375rem] leading-6 text-fg-muted">{item.text}</p>}
              {item.link.href && item.link.label && (
                <Link href={item.link.href} className="mt-3 inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-accent-text hover:underline">
                  {item.link.label} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

async function AuthorBio({ s }: { s: Of<"author"> }) {
  const author = await getAuthor(s.author);
  if (!author) return null;
  const links = s.showLinks ? author.frontmatter.sameAs : [];
  return (
    <Shell s={s} label="About the editor">
      <div className="grid gap-6 rounded-xl border border-line bg-surface-muted p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-8 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
        <UserAvatar name={author.frontmatter.name} size="lg" />
        <div>
          {s.eyebrow && <p className="eyebrow">{s.eyebrow}</p>}
          <h2 id={`${s.id}-title`} className="mt-1 text-xl font-semibold tracking-tight text-fg">
            {author.frontmatter.name}
          </h2>
          {s.text && <p className="mt-2 max-w-2xl text-base leading-7 text-fg-muted">{s.text}</p>}
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1 lg:flex-col">
          <Link href={author.path} className={buttonClass("secondary")}>
            Author profile
          </Link>
          {links.map((url) => (
            <a key={url} href={url} rel="me noopener" className={buttonClass("secondary")}>
              {url.includes("github.com") && <GitHubIcon className="h-4 w-4" />}
              {url.includes("linkedin.com") && <LinkedInIcon className="h-4 w-4" />}
              {new URL(url).hostname.replace(/^www\./, "").replace(/\.com$/, "").replace(/^./, (c) => c.toUpperCase())}
            </a>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Cta({ s }: { s: Of<"cta"> }) {
  return (
    <Shell s={s} label={s.heading}>
      <div className="rounded-xl border border-line bg-surface px-6 py-10 text-center sm:px-12">
        <h2 id={`${s.id}-title`} className="text-heading font-semibold text-fg text-balance">
          {s.heading}
        </h2>
        {s.text && <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-fg-muted">{s.text}</p>}
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href={s.primary.href} label={s.primary.label} variant="primary" />
          <ButtonLink href={s.secondary.href} label={s.secondary.label} variant="secondary" />
        </div>
      </div>
    </Shell>
  );
}

function TextBlock({ s }: { s: Of<"text"> }) {
  // Plain text only: blank lines separate paragraphs; nothing is interpreted as HTML or Markdown.
  const paragraphs = s.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <Shell s={s} label={s.heading}>
      <div className="max-w-reading">
        {s.heading && (
          <h2 id={`${s.id}-title`} className="text-heading font-semibold text-fg">
            {s.heading}
          </h2>
        )}
        <div className={`space-y-4 text-lg leading-8 text-fg-muted ${s.heading ? "mt-4" : ""}`}>
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/** Server-side registry of approved homepage sections. Unknown types cannot exist (validated schema). */
export async function HomeSections({ config }: { config: SiteConfig }) {
  const articles = await getPublishedContent();
  const visible = config.homepage.sections.filter((s) => !s.hidden);
  const ctx: Ctx = { config, articles };
  const hasHero = visible.some((s) => s.type === "hero");
  return (
    <>
      {/* Every page needs one h1; without a visible introduction it is the site name, for assistive technology. */}
      {!hasHero && <h1 className="sr-only">{config.general.siteName}</h1>}
      {visible.map((s) => {
        switch (s.type) {
          case "hero":
            return <Hero key={s.id} s={s} />;
          case "latest":
            return <Latest key={s.id} s={s} ctx={ctx} />;
          case "featured":
            return <Featured key={s.id} s={s} ctx={ctx} />;
          case "topics":
            return <Topics key={s.id} s={s} />;
          case "projects":
            return <Projects key={s.id} s={s} ctx={ctx} />;
          case "principles":
            return <Principles key={s.id} s={s} />;
          case "author":
            return <AuthorBio key={s.id} s={s} />;
          case "cta":
            return <Cta key={s.id} s={s} />;
          case "text":
            return <TextBlock key={s.id} s={s} />;
        }
      })}
    </>
  );
}
