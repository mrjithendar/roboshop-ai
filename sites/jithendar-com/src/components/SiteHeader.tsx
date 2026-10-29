import type { CSSProperties } from "react";
import { getSiteConfig } from "@/lib/site-config";
import { readableOn } from "@/lib/site-config/color";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";
import { NavLinks, type NavItem } from "./NavLinks";
import { BannerBackground } from "./site/BannerBackground";
import { socialLinks } from "./site/social";
import { ThemeSelect, ThemeToggle } from "./theme/ThemeToggle";

/** Site header, configured in Admin → Appearance → Header and Navigation. */
export async function SiteHeader() {
  const { config } = await getSiteConfig();
  const h = config.header;
  const menu = config.navigation.menus.find((m) => m.id === config.navigation.headerMenu);
  const items: NavItem[] = (menu?.items ?? []).map(({ label, href, newTab, children }) => ({ label, href, newTab, children: children.map(({ label, href, newTab }) => ({ label, href, newTab })) }));
  // Accent and image backgrounds use inverse text (contrast is validated before publishing).
  const inverse = h.background === "accent" || (h.background === "image" && !!h.image.desktop);
  const style: CSSProperties | undefined =
    h.background === "accent"
      ? ({ background: "var(--page-accent)", "--chrome-ink": "var(--page-on-accent)", "--chrome-ink-contrast": "var(--page-accent)" } as CSSProperties)
      : inverse
        ? ({ "--chrome-ink": "#ffffff", "--chrome-ink-contrast": readableOn("#ffffff") } as CSSProperties)
        : undefined;
  const bg = h.background === "muted" ? "bg-surface-muted" : h.background === "canvas" || (h.background === "image" && !h.image.desktop) ? "bg-canvas" : "";

  return (
    <header
      className={`${h.sticky ? "sticky top-0" : "relative"} isolate z-40 border-b border-line ${bg} ${inverse ? "chrome-inverse" : ""}`}
      style={style}
    >
      {h.background === "image" && <BannerBackground banner={h.image} priority />}
      <div
        className={`site-header-inner relative mx-auto flex h-header w-full items-center gap-4 px-4 sm:px-6 lg:gap-8 lg:px-8 ${h.width === "contained" ? "max-w-[calc(var(--container-page)+4rem)]" : ""}`}
      >
        <Logo branding={config.branding} siteName={config.general.siteName} size={h.logoSize} />
        <NavLinks
          items={items}
          align={h.navAlign}
          showSearch={h.showSearch}
          cta={h.cta.show && h.cta.label && h.cta.href ? { label: h.cta.label, href: h.cta.href } : null}
          social={h.showSocial ? socialLinks(config.general.social) : []}
          themeToggle={h.showThemeToggle ? <ThemeToggle /> : null}
          themeSelect={h.showThemeToggle ? <ThemeSelect /> : null}
          account={h.showAccount ? <AccountMenu /> : null}
        />
      </div>
    </header>
  );
}
