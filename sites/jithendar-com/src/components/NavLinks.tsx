"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, CloseIcon, MenuIcon, SearchIcon } from "./icons";
import { SocialIcon, type SocialLink } from "./site/social";

export type NavLeaf = { label: string; href: string; newTab: boolean };
export type NavItem = NavLeaf & { children: NavLeaf[] };

function isActive(pathname: string, href: string) {
  if (!href.startsWith("/") || href === "/") return pathname === href;
  const path = href.split(/[?#]/)[0]!;
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Internal paths use client navigation; external links are https only (validated) and never get the opener. */
function NavAnchor({ item, className, onClick, current }: { item: NavLeaf; className: string; onClick?: () => void; current?: boolean }) {
  if (item.href.startsWith("/") && !item.newTab) {
    return (
      <Link href={item.href} className={className} onClick={onClick} aria-current={current ? "page" : undefined}>
        {item.label}
      </Link>
    );
  }
  return (
    <a href={item.href} className={className} onClick={onClick} {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: item.href.startsWith("/") ? undefined : "noopener" })}>
      {item.label}
      {item.newTab && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

const iconButton = "inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg";

/** A top-level item with children: the item's own link plus a disclosure button for its submenu. */
function DesktopGroup({ item, pathname }: { item: NavItem; pathname: string }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = isActive(pathname, item.href) || item.children.some((c) => isActive(pathname, c.href));

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !wrapper.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <li ref={wrapper} className="relative flex items-center" onBlur={(e) => !wrapper.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <NavAnchor item={item} current={isActive(pathname, item.href)} className={`${linkBase} pr-1 ${active ? activeLink : idleLink}`} />
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        <span className="sr-only">{`${item.label} submenu`}</span>
      </button>
      {open && (
        <ul id={id} className="chrome-reset absolute left-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          {item.children.map((c) => (
            <li key={c.href + c.label}>
              <NavAnchor
                item={c}
                current={isActive(pathname, c.href)}
                onClick={() => setOpen(false)}
                className="flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-fg-muted hover:bg-surface-sunken hover:text-fg aria-[current=page]:text-fg"
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const linkBase = "relative inline-flex h-10 items-center rounded-lg px-3 text-[0.9375rem] font-medium transition-colors";
const activeLink = "text-fg after:absolute after:inset-x-3 after:bottom-[calc((var(--spacing-header)_-_2.5rem)/-2_-_1px)] after:h-0.5 after:rounded-full after:bg-accent";
const idleLink = "text-fg-muted hover:bg-surface-sunken hover:text-fg";

/** Primary navigation, search, CTA, social, theme and account controls; below md the links move into a disclosure menu. */
export function NavLinks({
  items,
  align,
  showSearch,
  cta,
  social,
  themeToggle,
  themeSelect,
  account,
}: {
  items: NavItem[];
  align: "start" | "center" | "end";
  showSearch: boolean;
  cta: { label: string; href: string } | null;
  social: SocialLink[];
  themeToggle: ReactNode;
  themeSelect: ReactNode;
  account: ReactNode;
}) {
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

  const justify = align === "center" ? "md:justify-center" : align === "end" ? "md:justify-end" : "";

  return (
    <>
      <nav aria-label="Main" className={`hidden min-w-0 md:flex md:flex-1 ${justify}`}>
        <ul className="flex items-center gap-1">
          {items.map((item) =>
            item.children.length > 0 ? (
              <DesktopGroup key={item.href + item.label} item={item} pathname={pathname} />
            ) : (
              <li key={item.href + item.label}>
                <NavAnchor item={item} current={isActive(pathname, item.href)} className={`${linkBase} ${isActive(pathname, item.href) ? activeLink : idleLink}`} />
              </li>
            ),
          )}
        </ul>
      </nav>

      <div className={`flex items-center gap-1 ${align === "end" ? "" : "ml-auto"} max-md:ml-auto`}>
        {social.length > 0 && (
          <ul aria-label="Follow" className="hidden items-center lg:flex">
            {social.map((s) => (
              <li key={s.key}>
                <a href={s.href} rel="me noopener" className={iconButton}>
                  <SocialIcon name={s.key} />
                  <span className="sr-only">{s.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {showSearch && (
          <Link href="/search" aria-label="Search" aria-current={pathname === "/search" ? "page" : undefined} className={`${iconButton} hidden sm:inline-flex ${cta ? "" : "lg:w-44 lg:justify-start lg:gap-2 lg:border lg:border-line lg:px-3 lg:text-sm lg:text-fg-subtle"}`}>
            <SearchIcon className="h-[18px] w-[18px]" />
            <span className={cta ? "sr-only" : "hidden lg:inline"}>Search</span>
          </Link>
        )}
        {themeToggle && <span className="hidden sm:contents">{themeToggle}</span>}
        {cta && (
          <NavAnchor
            item={{ ...cta, newTab: false }}
            className="ml-1 hidden h-9 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-sunken lg:inline-flex"
          />
        )}
        <button ref={toggle} type="button" className={`${iconButton} md:hidden`} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)}>
          {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
        {account && <div className="ml-1 flex items-center sm:ml-2">{account}</div>}
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Main" className="chrome-reset absolute inset-x-0 top-full max-h-[calc(100dvh-var(--spacing-header))] overflow-y-auto border-b border-line bg-canvas px-4 pb-4 pt-2 shadow-md sm:px-6 md:hidden">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href + item.label}>
                <NavAnchor
                  item={item}
                  current={isActive(pathname, item.href)}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-12 items-center rounded-lg px-3 text-base font-medium transition-colors ${isActive(pathname, item.href) ? "bg-surface-sunken text-fg" : "text-fg-muted hover:bg-surface-sunken hover:text-fg"}`}
                />
                {item.children.length > 0 && (
                  <ul className="mb-1 ml-3 border-l border-line pl-2">
                    {item.children.map((c) => (
                      <li key={c.href + c.label}>
                        <NavAnchor
                          item={c}
                          current={isActive(pathname, c.href)}
                          onClick={() => setOpen(false)}
                          className="flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] text-fg-muted hover:bg-surface-sunken hover:text-fg aria-[current=page]:text-fg"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {cta && (
              <li className="mt-2">
                <NavAnchor item={{ ...cta, newTab: false }} onClick={() => setOpen(false)} className="flex min-h-12 items-center justify-center rounded-[var(--radius-control)] bg-accent px-4 font-semibold text-on-accent" />
              </li>
            )}
          </ul>
          {(showSearch || themeSelect) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 sm:hidden">
              {showSearch && (
                <Link href="/search" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-medium text-fg-muted hover:bg-surface-sunken hover:text-fg">
                  <SearchIcon className="h-5 w-5" /> Search
                </Link>
              )}
              {themeSelect}
            </div>
          )}
        </nav>
      )}
    </>
  );
}
