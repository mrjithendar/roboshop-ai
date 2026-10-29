"use client";

import { authClient } from "./auth-client";
import { safeNext } from "./safe-next";

/** localStorage prefixes holding private, per-user data (the editor's local draft copies). Reader preferences stay. */
const PRIVATE_STORAGE_PREFIXES = ["editor:"];

/** Remove private data this site keeps in the browser. Never throws (storage can be blocked). */
export function clearPrivateBrowserData(storage: Pick<Storage, "length" | "key" | "removeItem"> | null = safeLocalStorage()) {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && PRIVATE_STORAGE_PREFIXES.some((p) => key.startsWith(p))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The sign-in page after signing out. Signing in again returns to `from` when it is a safe same-site path,
 * except private pages (admin/account), which the next person at this browser should not land on by default.
 */
export function signedOutHref(from?: string | null): string {
  const next = safeNext(from, "");
  const keep = next && next !== "/" && !/^\/(admin|account)(\/|$|\?|#)/.test(next);
  return keep ? `/login?signedOut=1&next=${encodeURIComponent(next)}` : "/login?signedOut=1";
}

let signingOut = false;

/** True while this tab is signing out on purpose (SessionGuard then leaves the redirect to signOutAndLeave). */
export function isSigningOut(): boolean {
  return signingOut;
}

/**
 * Sign out with Better Auth (deletes the session server-side and clears the cookie; also succeeds when the
 * session had already expired), clear private browser data, then load the sign-in page with a full
 * navigation, which discards the client router cache and every component's state, so nothing private
 * survives in memory. `replace` keeps the protected page out of the Back history.
 * Returns an error message when the server could not be reached (the user is still signed in then).
 */
export async function signOutAndLeave(from = typeof window === "undefined" ? null : window.location.pathname + window.location.search): Promise<string | null> {
  signingOut = true;
  try {
    const { error } = await authClient.signOut();
    // 401/403 mean there was no valid session left: already signed out as far as the server is concerned.
    if (error && error.status !== 401 && error.status !== 403) {
      signingOut = false;
      return "Could not sign out. Check your connection and try again.";
    }
  } catch {
    signingOut = false;
    return "Could not sign out. Check your connection and try again.";
  }
  clearPrivateBrowserData();
  window.location.replace(signedOutHref(from));
  return null;
}
