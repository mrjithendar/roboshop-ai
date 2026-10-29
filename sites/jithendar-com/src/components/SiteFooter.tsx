import { PrivacyChoices } from "./integrations/PrivacyChoices";
import Link from "next/link";
import { getCategories } from "@/lib/categories";
import { getSettings } from "@/lib/settings";
import { Container } from "./Container";
import { GitHubIcon, LinkedInIcon, RssIcon } from "./icons";
import { LogoMark } from "./Logo";

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

function Column({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-sm font-semibold text-ink dark:text-white">{title}</h2>
      <ul className="mt-4 space-y-3">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="inline-block py-1 text-sm text-slate-600 transition-colors hover:text-ink dark:text-slate-400 dark:hover:text-white">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function SiteFooter() {
  const settings = await getSettings();
  const topics = (await getCategories()).map((c) => ({ href: `/category/${c.slug}`, label: c.label }));
  const half = Math.ceil(topics.length / 2);
  return (
    <footer className="mt-24 border-t border-slate-200 bg-slate-50/60 dark:border-white/10 dark:bg-black/20">
      <Container className="py-14">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-7 w-7" />
              <span className="font-semibold text-ink dark:text-white">{settings.siteName}</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-400">{settings.description}</p>
            <div className="mt-6 flex items-center gap-3">
              <a
                href="/feed.xml"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20"
              >
                <RssIcon className="h-4 w-4 text-orange-500" />
                RSS feed
              </a>
              {settings.social.github && <a
                href={settings.social.github}
                rel="me noopener"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
              >
                <GitHubIcon className="h-4 w-4" />
                <span className="sr-only">GitHub</span>
              </a>}
              {settings.social.x && <a href={settings.social.x} rel="me noopener" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">X</a>}
              {settings.social.linkedin && (
                <a href={settings.social.linkedin} rel="me noopener" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                  <LinkedInIcon className="h-4 w-4" />
                  <span className="sr-only">LinkedIn</span>
                </a>
              )}
            </div>
          </div>
          <Column title="Publication" links={publication} />
          <Column title="Topics" links={topics.slice(0, half)} />
          <Column title="More topics" links={topics.slice(half)} />
          <Column title="Publication info" links={company} />
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-slate-200 pt-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:text-slate-400">
          <p>
            © {new Date().getFullYear()} {settings.siteName}. Every article is reviewed by a human editor.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {policies.map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="inline-block py-1 transition-colors hover:text-ink dark:hover:text-white">
                  {p.label}
                </Link>
              </li>
            ))}
            <li>
              <PrivacyChoices className="inline-block py-1 transition-colors hover:text-ink dark:hover:text-white" />
            </li>
          </ul>
        </div>
      </Container>
    </footer>
  );
}
