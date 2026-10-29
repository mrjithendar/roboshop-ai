"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { getAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth-errors";
import { log } from "@/lib/log";
import { PostError } from "@/lib/posts";
import { profileInput, removeAvatar, setAvatar, updateAccountProfile } from "@/lib/profile";
import { hit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";

export type AccountResult =
  | { ok: true; message: string }
  | { ok: false; error: string; issues?: string[]; code?: string; fieldErrors?: Record<string, string> };

const SIGNED_OUT: AccountResult = { ok: false, error: "Your session has expired. Sign in again to continue.", code: "UNAUTHORIZED" };
const TOO_MANY: AccountResult = { ok: false, error: "Too many changes in a short time. Please wait a few minutes and try again." };

async function guarded(fn: () => Promise<string>): Promise<AccountResult> {
  try {
    const message = await fn();
    revalidatePath("/account", "layout");
    return { ok: true, message };
  } catch (error) {
    if (error instanceof PostError) return { ok: false, error: error.message, issues: error.issues.length ? error.issues : undefined };
    log.error("account action failed", { err: error });
    return { ok: false, error: "Something went wrong. Please try again later." };
  }
}

/** Edit your own profile. The user id comes from the session; only allowlisted fields are read from the form. */
export async function updateProfileAction(form: FormData): Promise<AccountResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  if (!(await hit(`profile:${user.id}`, 20, 600))) return TOO_MANY;
  const field = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const input = { name: field("name"), bio: field("bio"), website: field("website"), github: field("github"), linkedin: field("linkedin"), x: field("x") };
  const check = profileInput.safeParse(input);
  if (!check.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of check.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  return guarded(async () => {
    await updateAccountProfile(user.id, input);
    return "Profile saved.";
  });
}

export async function uploadAvatarAction(form: FormData): Promise<AccountResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  if (!(await hit(`avatar:${user.id}`, 10, 3600))) return TOO_MANY;
  const file = form.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image to upload." };
  return guarded(async () => {
    await setAvatar(user.id, Buffer.from(await file.arrayBuffer()));
    return "Avatar updated.";
  });
}

export async function removeAvatarAction(): Promise<AccountResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  if (!(await hit(`avatar:${user.id}`, 10, 3600))) return TOO_MANY;
  return guarded(async () => {
    await removeAvatar(user.id);
    return "Avatar removed.";
  });
}

/**
 * Disconnect a sign-in method. Better Auth enforces ownership (only the session user's accounts),
 * a fresh session, and that the last way to sign in cannot be removed.
 */
export async function unlinkAccountAction(accountId: string): Promise<AccountResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  if (typeof accountId !== "string" || accountId.length > 100) return { ok: false, error: "Unknown account." };
  try {
    const auth = await getAuth();
    await auth.api.unlinkAccount({ headers: await headers(), body: { accountId } });
    revalidatePath("/account/settings");
    return { ok: true, message: "Disconnected." };
  } catch (error) {
    if (error instanceof APIError) {
      const code = String((error.body as { code?: string } | undefined)?.code ?? "");
      return { ok: false, error: authErrorMessage(code) ?? "Could not disconnect that account.", code };
    }
    log.error("unlink failed", { err: error });
    return { ok: false, error: "Something went wrong. Please try again later." };
  }
}

/** Sign out of every device, including this one. */
export async function signOutEverywhereAction(): Promise<AccountResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  try {
    const auth = await getAuth();
    await auth.api.revokeSessions({ headers: await headers() });
    return { ok: true, message: "Signed out everywhere." };
  } catch (error) {
    log.error("revoke sessions failed", { err: error });
    return { ok: false, error: "Something went wrong. Please try again later." };
  }
}
