import { avatarObjectKey, isAvatarRequest } from "@/lib/avatar";
import { isCurrentAvatar } from "@/lib/profile";
import { getObject, IMMUTABLE } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * A user's uploaded avatar, streamed from R2 under our own domain (no third-party request for readers).
 * Only the user's current avatar is served; file names are unique per upload, so responses are immutable.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string; file: string }> }) {
  const { userId, file } = await params;
  if (!isAvatarRequest(userId, file) || !(await isCurrentAvatar(userId, file))) return new Response("Not found", { status: 404 });
  const res = await getObject(avatarObjectKey(userId, file.replace(/\.webp$/, ""))).catch(() => null);
  if (!res?.Body) return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "30" } });
  const headers: Record<string, string> = {
    "Content-Type": "image/webp",
    "Cache-Control": IMMUTABLE,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (res.ContentLength !== undefined) headers["Content-Length"] = String(res.ContentLength);
  return new Response(res.Body.transformToWebStream(), { headers });
}
