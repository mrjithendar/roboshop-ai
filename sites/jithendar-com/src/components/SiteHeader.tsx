import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:border-white/10 dark:bg-surface-dark/80">
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Logo />
        <NavLinks />
      </div>
    </header>
  );
}
