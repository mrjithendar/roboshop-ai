import { markdownToHtml } from "@/lib/mdx/html";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Editor preview (staff only): the site's Markdown plugins rendered to HTML. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "author")) return new Response("Forbidden", { status: 403 });
  const { body } = (await request.json().catch(() => ({}))) as { body?: unknown };
  if (typeof body !== "string") return new Response("Bad request", { status: 400 });
  return new Response(await markdownToHtml(body.slice(0, 200_000)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
