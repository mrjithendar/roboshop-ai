"use server";

import { headers } from "next/headers";
import { submitContact } from "@/lib/contact";
import { PostError } from "@/lib/posts";

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

export async function submitContactAction(data: { name: string; email: string; subject: string; message: string }, token: string | null): Promise<PublicResult> {
  return guard(async () => {
    await submitContact(data, token, await clientIp());
    return "Thanks for getting in touch. Your message has been received.";
  });
}
