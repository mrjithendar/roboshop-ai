/** Social sign-in providers this site supports. */
export const SOCIAL_PROVIDERS = ["google", "github"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const providerLabels: Record<SocialProvider, string> = { google: "Google", github: "GitHub" };

type Credentials = { clientId: string; clientSecret: string };

/** A provider is enabled only when both its client ID and secret are set (server-side env, never NEXT_PUBLIC_). */
function credentials(provider: SocialProvider, env: Record<string, string | undefined>): Credentials | null {
  const prefix = provider.toUpperCase();
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function enabledProviders(env: Record<string, string | undefined> = process.env): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter((p) => credentials(p, env));
}

/**
 * Better Auth `socialProviders` for the configured providers, with the minimum scopes for sign-in:
 * - Google: openid, email, profile (Better Auth's defaults); authorization code + PKCE, ID token checked
 *   against the OIDC nonce; `select_account` so a shared browser does not silently pick an account.
 * - GitHub: only `user:email` (needed to read a verified address when the public one is hidden);
 *   the public profile needs no scope. Better Auth's default `read:user` is dropped.
 */
export function socialProviderConfig(env: Record<string, string | undefined> = process.env) {
  const google = credentials("google", env);
  const github = credentials("github", env);
  return {
    ...(google ? { google: { ...google, prompt: "select_account" as const } } : {}),
    ...(github ? { github: { ...github, disableDefaultScope: true, scope: ["user:email"] } } : {}),
  };
}

/** OAuth callback URLs to register in each provider console (derived from the auth base path). */
export function callbackUrl(origin: string, provider: SocialProvider): string {
  return `${origin.replace(/\/$/, "")}/api/auth/callback/${provider}`;
}
