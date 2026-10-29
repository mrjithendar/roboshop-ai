import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { Alert } from "@/components/ui/form";
import { adminExists } from "@/lib/setup";
import { SetupForm } from "./SetupForm";

export const metadata: Metadata = { title: "Setup", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** One-time bootstrap. Disappears (404) as soon as an admin exists. */
export default async function SetupPage() {
  if (await adminExists()) notFound();
  const configured = (process.env.ADMIN_BOOTSTRAP_TOKEN ?? "").length >= 32;
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <LogoMark className="mx-auto h-12 w-12" />
        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-fg">Set up the site</h1>
        <p className="mt-2 text-center text-sm text-fg-muted">Create the first admin account and import the existing articles.</p>
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          {configured ? <SetupForm /> : <Alert>Setup is disabled: ADMIN_BOOTSTRAP_TOKEN (32+ characters) is not configured.</Alert>}
        </div>
      </div>
    </div>
  );
}
