"use client";

import { useState } from "react";
import { GitHubIcon, GoogleIcon } from "@/components/icons";
import { Alert, buttonClass, Spinner } from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

type Provider = "google" | "github";
const meta: Record<Provider, { label: string; Icon: typeof GitHubIcon }> = {
  google: { label: "Google", Icon: GoogleIcon },
  github: { label: "GitHub", Icon: GitHubIcon },
};

/**
 * "Continue with …" buttons for the providers configured on the server. Better Auth runs the authorization
 * code flow with state + PKCE (and an OIDC nonce for Google); the browser only ever sees the redirect.
 * `next` and `errorPath` are same-site paths already validated by the page.
 */
export function SocialButtons({ providers, next, errorPath }: { providers: Provider[]; next: string; errorPath: string }) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (providers.length === 0) return null;

  async function start(provider: Provider) {
    setError(null);
    setPending(provider);
    const { error } = await authClient.signIn.social({ provider, callbackURL: next, errorCallbackURL: errorPath, newUserCallbackURL: next });
    // On success the browser is already leaving for the provider; only failures come back here.
    if (error) {
      setPending(null);
      setError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : (authErrorMessage(error.code) ?? "That sign-in method is unavailable right now."));
    }
  }

  return (
    <div className="space-y-3">
      {providers.map((p) => {
        const { label, Icon } = meta[p];
        return (
          <button
            key={p}
            type="button"
            onClick={() => start(p)}
            disabled={pending !== null}
            aria-busy={pending === p || undefined}
            className={`${buttonClass("secondary", "lg")} w-full text-[0.9375rem]`}
          >
            {pending === p ? <Spinner className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
            {pending === p ? `Connecting to ${label}…` : `Continue with ${label}`}
          </button>
        );
      })}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
