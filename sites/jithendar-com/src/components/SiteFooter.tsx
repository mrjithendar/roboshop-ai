import Link from "next/link";
import type { CSSProperties } from "react";
import { getCategories } from "@/lib/categories";
import { getSiteConfig } from "@/lib/site-config";
import { Container } from "./Container";
import { RssIcon } from "./icons";
import { PrivacyChoices } from "./integrations/PrivacyChoices";
import { LogoMark } from "./Logo";
import { BannerBackground } from "./site/BannerBackground";
import { SocialIcon, socialLinks } from "./site/social";
import { ThemeSelect } from "./theme/ThemeToggle";

/** Legal and consent links are always present, whatever the footer configuration (they are required). */
const policies = [
  { href: "/editorial-policy", label: "Editorial policy" },
  { href: "/corrections-policy", label: "Corrections" },
  { href: "/ai-use-policy", label: "AI use" },
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Terms" },
];

type FooterItem = { href: string; label: string; newTab?: boolean };

function FooterLink({ l, className }: { l: FooterItem; className: string }) {
  if (l.href.startsWith("/") && !l.newTab) return <Link href={l.href} className={className}>{l.label}</Link>;
  return (
    <a href={l.href} className={className} {...(l.newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" })}>
      {l.label}
      {l.newTab && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

function Column({ title, links, wide }: { title: string; links: FooterItem[]; wide: boolean }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <ul className={`mt-3 grid gap-x-6 sm:mt-4 ${wide ? "grid-cols-2" : ""}`}>
        {links.map((l) => (
          <li key={l.href + l.label}>
            <FooterLink l={l} className="inline-flex min-h-9 items-center text-sm text-fg-muted transition-colors hover:text-fg" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

const SPACING = { compact: "py-8 sm:py-10", regular: "py-12 sm:py-14", spacious: "py-16 sm:py-20" };

/** Site footer, configured in Admin → Appearance → Footer. */
export async function SiteFooter() {
  const { config } = await getSiteConfig();
  const f = config.footer;
  const g = config.general;
  const menus = new Map(config.navigation.menus.map((m) => [m.id, m]));
  const topics = f.columns.some((c) => c.source === "topics") ? (await getCategories()).map((c) => ({ href: `/category/${c.slug}`, label: c.label })) : [];
  const columns = f.columns
    .map((c) => ({ title: c.title, links: c.source === "topics" ? topics : (menus.get(c.menuId)?.items ?? []).map(({ href, label, newTab }) => ({ href, label, newTab })) }))
    .filter((c) => c.links.length > 0);
  const social = f.showSocial ? socialLinks(g.social) : [];
  const description = f.description || g.description;
  const copyright = f.copyright.replaceAll("{year}", String(new Date().getFullYear())).replaceAll("{site}", g.siteName);
  const centered = f.preset === "centered" || f.align === "center";
  const inverse = f.background === "inverted" || (f.background === "image" && !!f.image.desktop);
  const style = inverse
    ? ({ "--chrome-ink": f.background === "inverted" ? "var(--page-canvas)" : "#ffffff", "--chrome-ink-contrast": "#111317", ...(f.background === "inverted" ? { background: "var(--page-fg)" } : {}) } as CSSProperties)
    : undefined;
  const bg = f.background === "muted" ? "bg-surface-muted" : f.background === "canvas" || (f.background === "image" && !f.image.desktop) ? "bg-canvas" : "";

  const brand = (f.showLogo || description || social.length > 0 || f.showRss || (f.showContact && (g.contact.email || g.contact.location))) && (
    <div className={`max-w-sm ${centered ? "mx-auto text-center" : ""}`}>
      {f.showLogo && (
        <div className={`flex items-center gap-2.5 ${centered ? "justify-center" : ""}`}>
          <LogoMark className="h-7 w-7" />
          <span className="font-semibold text-fg">{g.siteName}</span>
        </div>
      )}
      {description && <p className="mt-4 text-sm leading-6 text-fg-muted">{description}</p>}
      {f.showContact && (g.contact.email || g.contact.location) && (
        <address className="mt-4 text-sm not-italic leading-6 text-fg-muted">
          {g.contact.email && (
            <a href={`mailto:${g.contact.email}`} className="block hover:text-fg hover:underline">
              {g.contact.email}
            </a>
          )}
          {g.contact.location && <span className="block">{g.contact.location}</span>}
        </address>
      )}
      {(f.showRss || social.length > 0) && (
        <ul aria-label="Follow" className={`mt-5 flex flex-wrap items-center gap-2 ${centered ? "justify-center" : ""}`}>
          {f.showRss && (
            <li>
              <a href="/feed.xml" className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-line px-3 text-sm font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg">
                <RssIcon className="h-4 w-4" />
                RSS feed
              </a>
            </li>
          )}
          {social.map((s) => (
            <li key={s.key}>
              <a href={s.href} rel="me noopener" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg-muted transition-colors hover:border-line-strong hover:text-fg">
                <SocialIcon name={s.key} />
                <span className="sr-only">{s.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const showColumns = f.preset !== "simple" && columns.length > 0;
  const gridCols = ["", "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]", "lg:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,1fr))]", "lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]", "lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]"][columns.length] ?? "";

  return (
    <footer className={`relative isolate mt-section border-t border-line ${bg} ${inverse ? "chrome-inverse" : ""}`} style={style}>
      {f.background === "image" && <BannerBackground banner={f.image} />}
      <Container className={SPACING[f.spacing]}>
        {centered ? (
          <div className="space-y-10 text-center">
            {brand}
            {showColumns && (
              <div className="mx-auto grid max-w-3xl gap-8 sm:grid-cols-2 lg:grid-cols-3 [&_ul]:justify-items-center">
                {columns.map((c) => (
                  <Column key={c.title} title={c.title} links={c.links} wide={false} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`grid gap-10 sm:grid-cols-2 lg:gap-12 ${showColumns ? gridCols : ""}`}>
            {brand && <div className="sm:col-span-2 lg:col-span-1">{brand}</div>}
            {showColumns && columns.map((c) => <Column key={c.title} title={c.title} links={c.links} wide={c.links.length > 6} />)}
          </div>
        )}
        <div className={`mt-10 flex flex-col gap-5 border-t border-line pt-6 text-sm text-fg-subtle lg:flex-row lg:items-center ${centered ? "items-center text-center lg:justify-center" : "lg:justify-between"}`}>
          {copyright && <p>{copyright}</p>}
          <div className={`flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6 ${centered ? "items-center" : ""}`}>
            <ul aria-label="Policies" className={`flex flex-wrap gap-x-4 gap-y-1 ${centered ? "justify-center" : ""}`}>
              {policies.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="inline-flex min-h-8 items-center transition-colors hover:text-fg">
                    {p.label}
                  </Link>
                </li>
              ))}
              <li>
                <PrivacyChoices className="inline-flex min-h-8 items-center transition-colors hover:text-fg" />
              </li>
            </ul>
            {config.header.showThemeToggle && (
              <div className="chrome-reset">
                <ThemeSelect />
              </div>
            )}
          </div>
        </div>
      </Container>
    </footer>
  );
}

