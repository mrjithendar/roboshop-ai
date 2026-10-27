"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number; section: string };

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const sections = [...new Set(items.map((i) => i.section))];
  return (
    <nav aria-label="Admin" className="space-y-6">
      {sections.map((section) => (
        <div key={section}>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{section}</p>
          <ul className="mt-2 space-y-0.5">
            {items
              .filter((i) => i.section === section)
              .map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active ? "bg-white text-ink shadow-sm dark:bg-white/10 dark:text-white" : "text-slate-600 hover:bg-white/60 hover:text-ink dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                      }`}
                    >
                      {item.label}
                      {item.badge ? (
                        <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{item.badge}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
