"use server";

import { revalidatePath } from "next/cache";
import { staffActor } from "@/lib/admin";
import { createApiKey } from "@/lib/api-keys";
import { PostError } from "@/lib/posts";

export type CreateKeyState = { key?: string; error?: string };

/** Returns the new key in the action result (never in a URL), shown once by the form. */
export async function createKeyAction(_prev: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const actor = await staffActor();
  try {
    const { key } = await createApiKey(actor, { name: form.get("name"), scopes: form.getAll("scopes"), expiresInDays: form.get("expiresInDays") || 0 });
    revalidatePath("/admin/api-keys");
    return { key };
  } catch (error) {
    return { error: error instanceof PostError ? [error.message, ...error.issues].join(" · ") : "Could not create the key." };
  }
}
