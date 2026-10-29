import { listComments } from "@/lib/comments";
import { getSiteConfig } from "@/lib/site-config";
import { turnstileSiteKey } from "@/lib/turnstile";
import { Discussion } from "./discussion/Discussion";

/**
 * The discussion under a post. Rendered with the public view (approved comments only, no viewer data), so the
 * article HTML is the same for everyone; signed-in readers load their own view in the browser.
 * Nothing is shown when comments are off site-wide or closed on this post.
 */
export async function Comments({ postId, path }: { postId: string; path: string }) {
  const initial = await listComments(postId, null).catch(() => null);
  if (!initial?.state.enabled) return null;
  const { config } = await getSiteConfig();
  return <Discussion postId={postId} path={path} initial={initial} siteKey={turnstileSiteKey()} timeZone={config.general.timezone} />;
}
