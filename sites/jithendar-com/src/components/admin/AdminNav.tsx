"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CloseIcon, MenuIcon } from "@/components/icons";

export type NavItem = { href: string; label: string; badge?: number; section: string };

const isActive = (href: string, pathname: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

/** Sidebar on large screens; below `lg` a "Menu" button (showing the current page) toggles the same list. */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the menu after navigating (React's "adjust state on prop change" pattern, no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  const sections = [...new Set(items.map((i) => i.section))];
  const current = items.find((i) => isActive(i.href, pathname));
  const pending = items.reduce((n, i) => n + (i.badge ?? 0), 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="admin-nav"
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm lg:hidden dark:border-white/10 dark:bg-surface-dark-raised dark:text-white"
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? <CloseIcon className="h-4 w-4 shrink-0" /> : <MenuIcon className="h-4 w-4 shrink-0" />}
          <span className="truncate">Menu{current ? ` · ${current.label}` : ""}</span>
        </span>
        {pending > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{pending}</span>}
      </button>
      <nav id="admin-nav" aria-label="Admin" className={`${open ? "mt-3 grid" : "hidden"} gap-6 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:mt-0 lg:grid lg:grid-cols-1 lg:border-0 lg:bg-transparent lg:p-0 dark:border-white/10 dark:bg-surface-dark-raised lg:dark:bg-transparent`}>
        {sections.map((section) => (
          <div key={section}>
            <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{section}</p>
            <ul className="mt-2 space-y-0.5">
              {items
                .filter((i) => i.section === section)
                .map((item) => {
                  const active = isActive(item.href, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-10 items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          active ? "bg-slate-100 text-ink shadow-sm lg:bg-white dark:bg-white/10 dark:text-white" : "text-slate-600 hover:bg-slate-50 hover:text-ink lg:hover:bg-white/60 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                        }`}
                      >
                        {item.label}
                        {item.badge ? <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{item.badge}</span> : null}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
