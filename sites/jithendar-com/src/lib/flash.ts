import { redirect } from "next/navigation";
import { PostError } from "./posts";

/** Server-action helper: run, then redirect back with ?ok= or ?error= (+ issues) for the page to show. */
export async function flash(path: string, fn: () => Promise<string | void>): Promise<never> {
  let target: string;
  try {
    const message = (await fn()) || "Saved.";
    target = `${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(message)}`;
  } catch (error) {
    if ((error as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw error;
    const known = error instanceof PostError;
    if (!known) {
      const { log } = await import("./log");
      log.error("admin action failed", { err: error, path });
    }
    const text = known ? [error.message, ...error.issues].join(" · ") : "Something went wrong. The error has been logged.";
    target = `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(text)}`;
  }
  redirect(target);
}
