"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-next";
import { isSigningOut } from "@/lib/sign-out";

/** Where an expired session on a private page goes: sign in again, then back to the same page. */
export function expiredHref(path: string): string {
  const next = safeNext(path, "");
  return `/login?expired=1${next ? `&next=${encodeURIComponent(next)}` : ""}`;
}

/**
 * Client half of the protection of private pages (admin, account); the server check on every request is the
 * real one. This makes sure an open tab never keeps showing private content after the session ends:
 * - a page restored from the back/forward cache (e.g. Back after signing out) reloads, so the server decides;
 * - when the session ends while the page is open (signed out in another tab, expired, revoked; Better Auth
 *   re-checks on focus), the page is replaced by the sign-in page; a different account reloads it.
 */
export function SessionGuard({ userId }: { userId: string }) {
  const pathname = usePathname();
  const { data, isPending, error } = authClient.useSession();

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  useEffect(() => {
    // A failed request (offline) is not a signed-out answer; a deliberate sign-out in this tab redirects itself.
    if (isPending || error || isSigningOut()) return;
    if (!data) window.location.replace(expiredHref(pathname + window.location.search));
    else if (data.user.id !== userId) window.location.reload();
  }, [data, isPending, error, userId, pathname]);

  return null;
}
