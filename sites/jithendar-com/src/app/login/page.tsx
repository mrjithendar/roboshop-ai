import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LogoMark } from "@/components/Logo";
import { Alert } from "@/components/ui/form";
import { getSessionUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { turnstileSiteKey } from "@/lib/turnstile";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  if (await getSessionUser()) redirect("/account");
  const settings = await getSettings();
  const { setup } = await searchParams;
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <div className="text-center">
          <LogoMark className="mx-auto h-12 w-12" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-ink dark:text-white">Sign in to {settings.siteName}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">One account for readers, authors and editors.</p>
        </div>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-white/10 dark:bg-surface-dark-raised">
          {setup === "done" && (
            <div className="mb-6">
              <Alert tone="success">Setup complete. Sign in with the admin account you just created.</Alert>
            </div>
          )}
          <Suspense>
            <LoginForm siteKey={turnstileSiteKey()} registrationOpen={settings.features.registration} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
          Protected by Cloudflare Turnstile. See the <Link href="/privacy-policy" className="underline">privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}
