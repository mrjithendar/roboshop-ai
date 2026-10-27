import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/Container";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/form";
import { getSessionUser } from "@/lib/session";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/account");
  const { denied } = await searchParams;
  return (
    <>
      <PageHeader title="Your account" eyebrow={user.role === "user" ? "Reader" : user.role === "author" ? "Author" : "Administrator"} narrow />
      <Container narrow className="space-y-6 py-12">
        {denied && <Alert>Your account does not have access to that area.</Alert>}
        <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
          {[
            ["Name", user.name],
            ["Email", user.email],
            ["Role", user.role],
            ["Email verified", user.emailVerified ? "Yes" : "No"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-5 py-4 text-sm">
              <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className="font-medium text-ink dark:text-white">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-3">
          {(user.role === "admin" || user.role === "author") && (
            <Link href="/admin" className="inline-flex items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-ink">
              Open admin
            </Link>
          )}
          <SignOutButton />
        </div>
      </Container>
    </>
  );
}
