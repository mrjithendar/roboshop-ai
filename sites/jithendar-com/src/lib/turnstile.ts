import { isProductionEnv } from "@/config/site";

// Cloudflare's documented test keys: always pass. Used only outside production when keys are unset.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";

export function turnstileSiteKey(): string | undefined {
  return process.env.TURNSTILE_SITE_KEY ?? (isProductionEnv() ? undefined : TEST_SITE_KEY);
}

export function turnstileSecret(): string | undefined {
  return process.env.TURNSTILE_SECRET_KEY ?? (isProductionEnv() ? undefined : TEST_SECRET);
}

/** Server-side Turnstile check for our own forms (contact, comments). Fails closed. */
export async function verifyTurnstile(token: string | null | undefined, ip?: string | null): Promise<boolean> {
  const secret = turnstileSecret();
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
