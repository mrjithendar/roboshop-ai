import { listComments } from "@/lib/comments";
import { PostError } from "@/lib/posts";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/comments/{postId}?sort=oldest|newest&cursor={id}&focus={commentId}
 * One page of threads as the current visitor sees them (likes, own pending comments, permissions).
 * Only approved comments (and the visitor's own pending ones) are included; never emails or user ids.
 */
export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const url = new URL(request.url);
  const user = await getSessionUser();
  try {
    const page = await listComments(postId, user ? { id: user.id, role: user.role } : null, {
      sort: url.searchParams.get("sort") === "newest" ? "newest" : "oldest",
      cursor: url.searchParams.get("cursor"),
      focus: url.searchParams.get("focus"),
    });
    if (!page.state.enabled) return Response.json({ error: "Comments are closed." }, { status: 404, headers: NO_STORE });
    return Response.json({ ...page, signedIn: !!user }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PostError) return Response.json({ error: error.message }, { status: error.status ?? 400, headers: NO_STORE });
    const { log } = await import("@/lib/log");
    log.error("comments list failed", { err: error });
    return Response.json({ error: "Comments could not be loaded." }, { status: 500, headers: NO_STORE });
  }
}
