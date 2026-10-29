import { actorOf } from "@/lib/admin";
import { startGeneration } from "@/lib/image-generation";
import { PostError } from "@/lib/posts";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
// Generation can take a while; the Gemini timeout (GEMINI_IMAGE_TIMEOUT_MS) is enforced inside.
export const maxDuration = 300;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

/** Cookie-authenticated JSON endpoint: refuse cross-site requests (CSRF) by checking Origin. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Generate an image for the editor (staff only). The request's abort signal is passed through,
 * so closing the dialog or pressing Cancel stops the upstream Gemini request too.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const user = await getSessionUser();
  if (!user) return json({ error: "Sign in again." }, 401);
  if (user.role !== "admin" && user.role !== "author") return json({ error: "Not allowed." }, 403);
  const body = (await req.json().catch(() => null)) as { prompt?: unknown; aspectRatio?: unknown } | null;
  if (!body) return json({ error: "Bad request." }, 400);
  try {
    return json(await startGeneration(actorOf(user), body, { signal: req.signal }));
  } catch (e) {
    if (e instanceof PostError) return json({ error: e.message }, e.status);
    return json({ error: "Image generation failed. The error has been logged." }, 500);
  }
}
