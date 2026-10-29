/**
 * Post-login destinations: same-site relative paths only (no open redirects). Rejects protocol-relative
 * (`//host`), backslash tricks (`/\host`, which browsers treat as `//host`), control characters and
 * anything that would resolve to another origin.
 */
export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  if (!next || next.length > 2048 || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "https://same-origin.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    // Never bounce back into the auth pages themselves.
    if (url.pathname === "/login" || url.pathname.startsWith("/api/auth/")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** The sign-in URL that returns to `path` afterwards. */
export function loginHref(path: string | null | undefined): string {
  const next = safeNext(path, "");
  return next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
