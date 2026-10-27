"use server";

import { headers } from "next/headers";
import { submitComment } from "@/lib/comments";
import { submitContact } from "@/lib/contact";
import { PostError } from "@/lib/posts";
import { getSessionUser } from "@/lib/session";

export type PublicResult = { ok: true; message: string } | { ok: false; error: string; issues?: string[] };

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function guard(fn: () => Promise<string>): Promise<PublicResult> {
  try {
    return { ok: true, message: await fn() };
  } catch (error) {
    if (error instanceof PostError) return { ok: false, error: error.message, issues: error.issues };
    const { log } = await import("@/lib/log");
    log.error("public form failed", { err: error });
    return { ok: false, error: "Something went wrong. Please try again later." };
  }
}

export async function submitCommentAction(postId: string, body: string, token: string | null): Promise<PublicResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in to comment." };
  return guard(async () => {
    const status = await submitComment(user, postId, body, token, await clientIp());
    return status === "approved" ? "Your comment is published." : "Thanks! Your comment will appear after moderation.";
  });
}

export async function submitContactAction(data: { name: string; email: string; subject: string; message: string }, token: string | null): Promise<PublicResult> {
  return guard(async () => {
    await submitContact(data, token, await clientIp());
    return "Thanks for getting in touch. Your message has been received.";
  });
}
