"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon, MenuIcon, SearchIcon } from "./icons";

export const navItems = [
  { href: "/blog", label: "Articles" },
  { href: "/news", label: "News" },
  { href: "/projects", label: "Projects" },
  { href: "/about", label: "About" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const iconButton = "inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg";

/** Primary navigation, search, theme and account controls; below md the links move into a disclosure menu. */
export function NavLinks({ themeToggle, themeSelect, account }: { themeToggle: ReactNode; themeSelect: ReactNode; account: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  // Close the mobile menu after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Escape closes the mobile menu and returns focus to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav aria-label="Main" className="hidden md:block">
        <ul className="flex items-center gap-1">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex h-10 items-center rounded-lg px-3 text-[0.9375rem] font-medium transition-colors ${
                    active ? "text-fg after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-accent" : "text-fg-muted hover:bg-surface-sunken hover:text-fg"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <Link href="/search" aria-label="Search" aria-current={pathname === "/search" ? "page" : undefined} className={`${iconButton} hidden sm:inline-flex lg:w-44 lg:justify-start lg:gap-2 lg:border lg:border-line lg:px-3 lg:text-sm lg:text-fg-subtle`}>
          <SearchIcon className="h-[18px] w-[18px]" />
          <span className="hidden lg:inline">Search</span>
        </Link>
        <span className="hidden sm:contents">{themeToggle}</span>
        <button
          ref={toggle}
          type="button"
          className={`${iconButton} md:hidden`}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
        <div className="ml-1 flex items-center sm:ml-2">{account}</div>
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Main" className="absolute inset-x-0 top-full border-b border-line bg-canvas px-4 pb-4 pt-2 shadow-md sm:px-6 md:hidden">
          <ul className="flex flex-col">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-12 items-center rounded-lg px-3 text-base font-medium transition-colors ${
                      active ? "bg-surface-sunken text-fg" : "text-fg-muted hover:bg-surface-sunken hover:text-fg"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 sm:hidden">
            <Link href="/search" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-medium text-fg-muted hover:bg-surface-sunken hover:text-fg">
              <SearchIcon className="h-5 w-5" /> Search
            </Link>
            {themeSelect}
          </div>
        </nav>
      )}
    </>
  );
}
