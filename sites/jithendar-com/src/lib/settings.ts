import { getPublishedConfig } from "./site-config/store";
import type { Section } from "./site-config/schema";

/**
 * Compatibility view of the published site configuration for library code (auth, comments, contact,
 * login, footer…). Edit settings in Admin → Appearance; they apply after publishing.
 */
export type Settings = {
  siteName: string;
  publicationName: string;
  description: string;
  hero: { eyebrow: string; title: string; highlight: string; subtitle: string };
  features: { comments: boolean; registration: boolean; contactForm: boolean };
  social: { github: string; x: string; linkedin: string };
  announcement: { enabled: boolean; text: string; href: string };
};

export async function getSettings(): Promise<Settings> {
  const { config: c } = await getPublishedConfig();
  const hero = c.homepage.sections.find((s): s is Extract<Section, { type: "hero" }> => s.type === "hero");
  return {
    siteName: c.general.siteName,
    publicationName: c.general.publicationName,
    description: c.general.description,
    hero: { eyebrow: hero?.eyebrow ?? "", title: hero?.heading ?? "", highlight: hero?.highlight ?? "", subtitle: hero?.subtitle ?? "" },
    features: c.general.features,
    social: { github: c.general.social.github, x: c.general.social.x, linkedin: c.general.social.linkedin },
    announcement: { enabled: c.header.announcement.enabled, text: c.header.announcement.text, href: c.header.announcement.href },
  };
}
