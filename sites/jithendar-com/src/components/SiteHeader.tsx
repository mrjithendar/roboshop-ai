import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import { ThemeSelect, ThemeToggle } from "./theme/ThemeToggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="site-header-inner relative mx-auto flex h-header w-full max-w-[calc(var(--container-page)+4rem)] items-center gap-4 px-4 sm:px-6 lg:gap-8 lg:px-8">
        <Logo />
        <NavLinks themeToggle={<ThemeToggle />} themeSelect={<ThemeSelect />} account={<AccountMenu />} />
      </div>
    </header>
  );
}
