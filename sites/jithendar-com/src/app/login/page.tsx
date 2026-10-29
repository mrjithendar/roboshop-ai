import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { Alert } from "@/components/ui/form";
import { enabledProviders } from "@/lib/auth-providers";
import { authErrorMessage } from "@/lib/auth-errors";
import { safeNext } from "@/lib/safe-next";
import { getSessionUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { turnstileSiteKey } from "@/lib/turnstile";
import { LoginForm } from "./LoginForm";
import { SocialButtons } from "./SocialButtons";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Params = { setup?: string; next?: string; error?: string; reauth?: string; expired?: string; signedOut?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { setup, next: rawNext, error, reauth, expired, signedOut } = await searchParams;
  const next = safeNext(rawNext);
  const confirming = reauth === "1";
  const user = await getSessionUser();
  // Already signed in: go on, unless this is a deliberate re-authentication before a sensitive change.
  if (user && !confirming) redirect(next);

  const settings = await getSettings();
  const providers = enabledProviders();
  const siteKey = turnstileSiteKey();
  const errorPath = `/login?next=${encodeURIComponent(next)}${confirming ? "&reauth=1" : ""}`;
  const message = authErrorMessage(error);

  return (
    <div className="flex min-h-[calc(100dvh-var(--spacing-header)-12rem)] items-center justify-center px-4 py-12 sm:py-16">
      <div className="w-full max-w-[26rem]">
        <div className="text-center">
          <LogoMark className="mx-auto h-10 w-10" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg">{confirming ? "Confirm it's you" : `Sign in to ${settings.siteName}`}</h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-fg-muted">
            {confirming ? "For your security, sign in again before changing how you sign in." : "One account for readers, authors and editors."}
          </p>
        </div>
        <div className="mt-8 space-y-6 rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-8">
          {setup === "done" && <Alert tone="success">Setup complete. Sign in with the admin account you just created.</Alert>}
          {signedOut === "1" && !message && <Alert tone="success">You have signed out.</Alert>}
          {expired === "1" && signedOut !== "1" && !message && <Alert tone="info">Your session has expired. Sign in again to continue.</Alert>}
          {message && <Alert>{message}</Alert>}
          <SocialButtons providers={providers} next={next} errorPath={errorPath} />
          {providers.length > 0 && siteKey && (
            <div className="flex items-center gap-3 text-sm text-fg-subtle" role="separator" aria-label="or">
              <span className="h-px flex-1 bg-line" />
              or use email
              <span className="h-px flex-1 bg-line" />
            </div>
          )}
          {(siteKey || providers.length === 0) && <LoginForm siteKey={siteKey} registrationOpen={settings.features.registration} next={next} />}
        </div>
        <p className="mt-6 text-center text-sm leading-6 text-fg-subtle">
          {siteKey ? "Email sign-in is protected by Cloudflare Turnstile. " : ""}See the{" "}
          <Link href="/privacy-policy" className="link">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
