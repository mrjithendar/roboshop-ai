import { actorOf } from "@/lib/admin";
import { generationPreview } from "@/lib/image-generation";
import { PostError } from "@/lib/posts";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Preview of an unaccepted generated image: only its author (or an admin), never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "author")) return new Response("Not found", { status: 404 });
  try {
    const { body, contentType } = await generationPreview(actorOf(user), (await params).id);
    return new Response(body, { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
  } catch (e) {
    return new Response(e instanceof PostError ? e.message : "Unavailable", { status: e instanceof PostError ? e.status : 503 });
  }
}
