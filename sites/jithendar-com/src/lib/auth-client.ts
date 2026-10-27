"use client";

import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [adminClient()] });

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
