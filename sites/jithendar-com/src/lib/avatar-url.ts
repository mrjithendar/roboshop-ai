/** Hosts whose avatar URLs (set by Google/GitHub sign-in) may be shown. The browser loads them; the server never fetches them. */
const PROVIDER_AVATAR_HOSTS = new Set(["lh3.googleusercontent.com", "avatars.githubusercontent.com"]);

/**
 * The avatar URL to render, or null for the initials fallback. Allows our own uploads (/media/…) and
 * HTTPS images from the sign-in providers only; anything else stored in `user.image` is ignored.
 */
export function displayableAvatar(image: string | null | undefined): string | null {
  if (!image) return null;
  if (image.startsWith("/media/") && !image.includes("..")) return image;
  try {
    const url = new URL(image);
    return url.protocol === "https:" && PROVIDER_AVATAR_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}
