"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { loginHref } from "@/lib/safe-next";
import { signOutAndLeave } from "@/lib/sign-out";
import { LayoutIcon, SettingsIcon, SignOutIcon, UserIcon } from "./icons";
import { UserAvatar } from "./UserAvatar";

const STAFF = new Set(["admin", "author"]);

/**
 * The account control at the far right of the header. It reads the session in the browser
 * (GET /api/auth/get-session, never cached), so cached public HTML never contains anyone's account;
 * a same-size placeholder shows until the session is known, so the wrong state never flashes.
 */
export function AccountMenu() {
  const { data, isPending } = authClient.useSession();
  const pathname = usePathname();

  if (isPending) return <span className="skeleton block h-9 w-9 rounded-full" aria-hidden="true" />;
  if (!data) {
    // On the login page itself, "Sign in" would only reload it.
    if (pathname === "/login") return null;
    return (
      <Link
        href={loginHref(pathname)}
        className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
      >
        Sign in
      </Link>
    );
  }
  const user = data.user as typeof data.user & { role?: string | null };
  return <Menu name={user.name} email={user.email} image={user.image} staff={STAFF.has(user.role ?? "")} />;
}

function Menu({ name, email, image, staff }: { name: string; email: string; image?: string | null; staff: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Close after navigating (adjust-state-on-change pattern, no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const items = () => [...(wrapper.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  // Outside click/tap closes; focus moves to the first item when opened.
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list.at(-1)?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    // On success the page is replaced by the sign-in page; only a failure comes back here.
    const error = await signOutAndLeave();
    setSigningOut(false);
    setSignOutError(error);
  }

  const item =
    "flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-fg-muted outline-none transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:bg-surface-sunken focus-visible:text-fg focus-visible:outline-none";

  return (
    <div ref={wrapper} className="relative" onKeyDown={open ? onMenuKey : undefined}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKey}
        className="flex h-10 w-10 items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-line-strong aria-expanded:ring-2 aria-expanded:ring-accent"
      >
        <UserAvatar name={name} image={image} size="sm" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="chrome-reset absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] origin-top-right rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-line px-3 pb-3 pt-2" role="none">
            <UserAvatar name={name} image={image} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg" title={name}>
                {name}
              </p>
              {email && (
                <p className="truncate text-xs text-fg-subtle" title={email}>
                  {email}
                </p>
              )}
            </div>
          </div>
          <div className="py-1.5" role="none">
            <Link role="menuitem" tabIndex={-1} href="/account" className={item} onClick={() => setOpen(false)}>
              <UserIcon className="h-4 w-4" /> My profile
            </Link>
            <Link role="menuitem" tabIndex={-1} href="/account/settings" className={item} onClick={() => setOpen(false)}>
              <SettingsIcon className="h-4 w-4" /> Account settings
            </Link>
            {staff && (
              <Link role="menuitem" tabIndex={-1} href="/admin" className={item} onClick={() => setOpen(false)}>
                <LayoutIcon className="h-4 w-4" /> Dashboard
              </Link>
            )}
          </div>
          <div className="border-t border-line pt-1.5" role="none">
            <button role="menuitem" tabIndex={-1} type="button" className={item} onClick={signOut} disabled={signingOut}>
              <SignOutIcon className="h-4 w-4" /> {signingOut ? "Signing out…" : "Sign out"}
            </button>
            {signOutError && (
              <p role="alert" className="px-3 pb-2 pt-1 text-xs text-red-700 dark:text-red-300">
                {signOutError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
