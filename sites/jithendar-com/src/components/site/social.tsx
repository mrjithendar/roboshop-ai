import { GitHubIcon, LinkedInIcon, MastodonIcon, YouTubeIcon } from "../icons";
import type { SiteConfig } from "@/lib/site-config/schema";

export type SocialLink = { key: string; label: string; href: string };

const LABELS: Record<keyof SiteConfig["general"]["social"], string> = { github: "GitHub", x: "X (Twitter)", linkedin: "LinkedIn", youtube: "YouTube", mastodon: "Mastodon" };

/** Configured social profiles (validated https URLs), in a fixed order. */
export function socialLinks(social: SiteConfig["general"]["social"]): SocialLink[] {
  return (Object.keys(LABELS) as (keyof typeof LABELS)[]).filter((k) => social[k]).map((k) => ({ key: k, label: LABELS[k], href: social[k] }));
}

export function SocialIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  if (name === "github") return <GitHubIcon className={className} />;
  if (name === "linkedin") return <LinkedInIcon className={className} />;
  if (name === "youtube") return <YouTubeIcon className={className} />;
  if (name === "mastodon") return <MastodonIcon className={className} />;
  return (
    <span className="text-sm font-semibold leading-none" aria-hidden="true">
      X
    </span>
  );
}
