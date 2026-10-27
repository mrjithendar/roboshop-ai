import type { Actor } from "./posts";
import { PostError } from "./posts";
import { requireRole, type SessionUser } from "./session";

export const actorOf = (u: SessionUser): Actor => ({ id: u.id, role: u.role, label: u.email });

/** For server actions: the signed-in staff member (admin or author), or a redirect to /login. */
export async function staffActor(): Promise<Actor> {
  return actorOf(await requireRole("admin", "author"));
}

export async function adminActor(): Promise<Actor> {
  return actorOf(await requireRole("admin"));
}

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string; issues?: string[] };

/** Turn service errors into a form-friendly result; unexpected errors are logged and hidden. */
export async function run<T>(fn: () => Promise<T>, success?: (v: T) => ActionResult): Promise<ActionResult> {
  try {
    const value = await fn();
    return success ? success(value) : { ok: true };
  } catch (error) {
    if (error instanceof PostError) return { ok: false, error: error.message, issues: error.issues };
    if ((error as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw error;
    const { log } = await import("./log");
    log.error("admin action failed", { err: error });
    return { ok: false, error: "Something went wrong. The error has been logged." };
  }
}
