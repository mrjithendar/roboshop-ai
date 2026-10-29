import { PrivacyChoices } from "./integrations/PrivacyChoices";
import Link from "next/link";
import { getCategories } from "@/lib/categories";
import { getSettings } from "@/lib/settings";
import { Container } from "./Container";
import { GitHubIcon, LinkedInIcon, RssIcon } from "./icons";
import { LogoMark } from "./Logo";
import { ThemeSelect } from "./theme/ThemeToggle";

const publication = [
  { href: "/blog", label: "Articles" },
  { href: "/news", label: "News" },
  { href: "/projects", label: "Projects" },
  { href: "/search", label: "Search" },
];

const company = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/authors/jithendar-dharmapuri", label: "Author" },
];

const policies = [
  { href: "/editorial-policy", label: "Editorial policy" },
  { href: "/corrections-policy", label: "Corrections" },
  { href: "/ai-use-policy", label: "AI use" },
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Terms" },
];

function Column({ title, links, className = "" }: { title: string; links: { href: string; label: string }[]; className?: string }) {
  return (
    <nav aria-label={title} className={className}>
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <ul className="mt-3 grid gap-x-6 sm:mt-4">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-fg-muted transition-colors hover:text-fg">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const socialButton =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted transition-colors hover:border-line-strong hover:text-fg";

export async function SiteFooter() {
  const settings = await getSettings();
  const topics = (await getCategories()).map((c) => ({ href: `/category/${c.slug}`, label: c.label }));
  return (
    <footer className="mt-section border-t border-line bg-surface-muted">
      <Container className="py-12 sm:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.8fr)] lg:gap-12">
          <div className="max-w-sm sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-7 w-7" />
              <span className="font-semibold text-fg">{settings.siteName}</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-fg-muted">{settings.description}</p>
            <ul aria-label="Follow" className="mt-5 flex flex-wrap items-center gap-2">
              <li>
                <a href="/feed.xml" className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg">
                  <RssIcon className="h-4 w-4" />
                  RSS feed
                </a>
              </li>
              {settings.social.github && (
                <li>
                  <a href={settings.social.github} rel="me noopener" className={socialButton}>
                    <GitHubIcon className="h-4 w-4" />
                    <span className="sr-only">GitHub</span>
                  </a>
                </li>
              )}
              {settings.social.x && (
                <li>
                  <a href={settings.social.x} rel="me noopener" className={`${socialButton} text-sm font-semibold`}>
                    X<span className="sr-only"> (Twitter)</span>
                  </a>
                </li>
              )}
              {settings.social.linkedin && (
                <li>
                  <a href={settings.social.linkedin} rel="me noopener" className={socialButton}>
                    <LinkedInIcon className="h-4 w-4" />
                    <span className="sr-only">LinkedIn</span>
                  </a>
                </li>
              )}
            </ul>
          </div>
          <Column title="Publication" links={publication} />
          <nav aria-label="Topics">
            <h2 className="text-sm font-semibold text-fg">Topics</h2>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 sm:mt-4">
              {topics.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-fg-muted transition-colors hover:text-fg">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Column title="Publication info" links={company} />
        </div>
        <div className="mt-10 flex flex-col gap-5 border-t border-line pt-6 text-sm text-fg-subtle lg:flex-row lg:items-center lg:justify-between">
          <p>
            © {new Date().getFullYear()} {settings.siteName}. Every article is reviewed by a human editor.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            <ul aria-label="Policies" className="flex flex-wrap gap-x-4 gap-y-1">
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
            <ThemeSelect />
          </div>
        </div>
      </Container>
    </footer>
  );
}
