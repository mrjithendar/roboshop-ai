import { LinkedInIcon, LinkIcon } from "./icons";
import { CopyLink } from "./CopyLink";

type Network = "x" | "linkedin" | "email" | "copy";

/**
 * Plain share links (no third-party scripts, no tracking pixels): each opens the network's own share page.
 */
export function ShareLinks({ url, title, networks }: { url: string; title: string; networks: Network[] }) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links: Partial<Record<Network, { href: string; label: string; icon: React.ReactNode }>> = {
    x: { href: `https://x.com/intent/post?url=${u}&text=${t}`, label: "X", icon: <span className="text-sm font-semibold" aria-hidden="true">X</span> },
    linkedin: { href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, label: "LinkedIn", icon: <LinkedInIcon className="h-4 w-4" /> },
    email: { href: `mailto:?subject=${t}&body=${u}`, label: "Email", icon: <LinkIcon className="h-4 w-4" /> },
  };
  const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg";
  return (
    <section aria-label="Share this article" className="mt-10 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-semibold text-fg">Share</span>
      {networks.map((n) =>
        n === "copy" ? (
          <CopyLink key={n} url={url} className={btn} />
        ) : (
          <a key={n} href={links[n]!.href} target={n === "email" ? undefined : "_blank"} rel="noopener noreferrer" className={btn}>
            {links[n]!.icon}
            {links[n]!.label}
            {n !== "email" && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        ),
      )}
    </section>
  );
}
