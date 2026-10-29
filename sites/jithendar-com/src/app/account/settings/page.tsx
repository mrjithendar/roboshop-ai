import type { Metadata } from "next";
import Link from "next/link";
import { Alert, buttonClass } from "@/components/ui/form";
import { FRESH_SESSION_SECONDS } from "@/lib/auth";
import { enabledProviders, providerLabels } from "@/lib/auth-providers";
import { authErrorMessage } from "@/lib/auth-errors";
import { formatDate } from "@/lib/dates";
import { connectedAccounts } from "@/lib/profile";
import { isFreshSession, requireUser } from "@/lib/session";
import { Section } from "../Section";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { SessionControls } from "./SessionControls";

export const metadata: Metadata = { title: "Account settings" };

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<{ linked?: string; error?: string }> }) {
  const user = await requireUser("/account/settings");
  const [accounts, { linked, error }] = await Promise.all([connectedAccounts(user.id), searchParams]);
  const fresh = isFreshSession(user, FRESH_SESSION_SECONDS);
  const linkedLabel = linked === "google" || linked === "github" ? providerLabels[linked] : null;
  const staff = user.role === "admin" || user.role === "author";

  return (
    <div className="space-y-6">
      {linkedLabel && accounts.some((a) => a.providerId === linked) && <Alert tone="success">{linkedLabel} is now connected. You can use it to sign in.</Alert>}
      {error && <Alert>{authErrorMessage(error)}</Alert>}

      <Section id="email-title" title="Email address">
        <p className="text-[0.9375rem] font-medium text-fg [overflow-wrap:anywhere]">{user.email}</p>
        <p className="mt-1 text-sm leading-6 text-fg-muted">
          {user.emailVerified ? "Verified." : "Not verified."} Your email address is your account identity and cannot be changed here.
        </p>
      </Section>

      <Section
        id="connections-title"
        title="Sign-in methods"
        description="Connect Google or GitHub to sign in with them. Connecting requires signing in to that account; accounts are never linked automatically."
      >
        <ConnectedAccounts
          accounts={accounts.map((a) => ({ id: a.id, providerId: a.providerId, connectedAt: formatDate(a.createdAt.toISOString()) }))}
          available={enabledProviders()}
          fresh={fresh}
        />
      </Section>

      <Section id="sessions-title" title="Sessions" description="Sessions last seven days and are extended while you use the site.">
        <SessionControls />
      </Section>

      {staff && (
        <Section id="workspace-title" title="Editorial workspace">
          <Link href="/admin" className={buttonClass("secondary")}>
            Open the dashboard
          </Link>
        </Section>
      )}
    </div>
  );
}
