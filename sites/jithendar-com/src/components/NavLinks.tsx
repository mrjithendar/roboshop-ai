"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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

export function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const linkClass = (href: string) =>
    `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      isActive(pathname, href)
        ? "text-ink dark:text-white bg-slate-100 dark:bg-white/10"
        : "text-slate-600 hover:text-ink hover:bg-slate-50 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/5"
    }`;

  return (
    <>
      <nav aria-label="Main" className="hidden md:block">
        <ul className="flex items-center gap-1">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={linkClass(item.href)} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex items-center gap-2">
        <Link
          href="/search"
          aria-label="Search"
          className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:text-ink dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-white"
        >
          <SearchIcon className="h-4 w-4" />
          <span className="hidden lg:inline">Search</span>
        </Link>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 md:hidden dark:border-white/10 dark:text-slate-200"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Main" className="absolute inset-x-0 top-full border-b border-slate-200 bg-white px-5 pb-5 pt-2 shadow-lg md:hidden dark:border-white/10 dark:bg-surface-dark">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block ${linkClass(item.href)} text-base`}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
