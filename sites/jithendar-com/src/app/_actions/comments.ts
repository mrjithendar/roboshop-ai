"use server";

import { headers } from "next/headers";
import {
  deleteOwnComment,
  editComment,
  listComments,
  ownCommentSource,
  previewComment,
  reportComment,
  setLike,
  submitComment,
  type CommentView,
} from "@/lib/comments";
import { PostError } from "@/lib/posts";
import { hit } from "@/lib/rate-limit";
import { getSessionUser, type SessionUser } from "@/lib/session";

/**
 * Comment actions for signed-in readers. Every action reads the user from the session cookie (never from the
 * arguments); ownership, discussion state and limits are enforced in lib/comments.
 */
export type CommentResult<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string; signedOut?: true };

const SIGNED_OUT = { ok: false as const, error: "Your session has ended. Sign in again to continue.", signedOut: true as const };

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function signedIn<T extends object>(fn: (user: SessionUser) => Promise<T & { message?: string }>): Promise<CommentResult<T>> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  try {
    return { ok: true, ...(await fn(user)) };
  } catch (error) {
    if (error instanceof PostError) return { ok: false, error: error.message };
    const { log } = await import("@/lib/log");
    log.error("comment action failed", { err: error });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** The thread containing `id`, as this user sees it (after posting, editing or deleting). */
async function threadOf(postId: string, id: string, user: SessionUser): Promise<CommentView | null> {
  const page = await listComments(postId, { id: user.id, role: user.role }, { focus: id });
  return page.threads[0] ?? null;
}

export async function postCommentAction(input: { postId: string; parentId?: string | null; body: string; clientKey: string; token: string | null }) {
  return signedIn(async (user) => {
    const r = await submitComment(user, { postId: input.postId, parentId: input.parentId ?? null, body: input.body, clientKey: input.clientKey, turnstileToken: input.token, ip: await clientIp() });
    return {
      id: r.id,
      status: r.status,
      thread: await threadOf(input.postId, r.id, user),
      message: r.status === "approved" ? "Your comment is published." : "Thanks! Your comment will appear after a moderator approves it.",
    };
  });
}

export async function previewCommentAction(body: string) {
  return signedIn(async (user) => {
    if (!(await hit(`comment-preview:${user.id}`, 60, 600))) throw new PostError("Too many previews. Please wait a moment.", 429);
    return { html: previewComment(body) };
  });
}

export async function editCommentAction(postId: string, id: string, body: string) {
  return signedIn(async (user) => {
    await editComment(user, id, body);
    return { thread: await threadOf(postId, id, user), message: "Comment updated." };
  });
}

export async function commentSourceAction(id: string) {
  return signedIn(async (user) => ({ body: await ownCommentSource(user, id) }));
}

export async function deleteCommentAction(postId: string, id: string) {
  return signedIn(async (user) => {
    await deleteOwnComment(user, id);
    return { thread: await threadOf(postId, id, user), message: "Comment deleted." };
  });
}

export async function likeCommentAction(id: string, liked: boolean) {
  return signedIn(async (user) => setLike(user, id, liked));
}

export async function reportCommentAction(id: string, reason: string, note: string) {
  return signedIn(async (user) => {
    const r = await reportComment(user, id, reason, note);
    return { message: r === "already" ? "You already reported this comment." : "Thanks. A moderator will review it." };
  });
}
