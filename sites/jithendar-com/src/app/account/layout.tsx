import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Container } from "@/components/Container";
import { SessionGuard } from "@/components/SessionGuard";
import { getSessionUser } from "@/lib/session";
import { AccountTabs } from "./AccountTabs";

// Private, per-user pages: never indexed, never cached (dynamic rendering sends Cache-Control: private, no-store).
export const metadata: Metadata = { title: { default: "Your account", template: "%s · Your account" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  // Each page checks the session itself (requireUser); the guard only reacts to it ending in the browser.
  const user = await getSessionUser();
  return (
    <>
      <div className="border-b border-line bg-surface-muted">
        <Container narrow className="pt-10 sm:pt-12">
          <h1 className="text-title font-bold text-fg">Your account</h1>
          <p className="mt-2 text-[0.9375rem] text-fg-muted">Private to you. Nothing here is shown publicly unless noted.</p>
          <div className="mt-6">
            <AccountTabs />
          </div>
        </Container>
      </div>
      <Container narrow className="py-8 sm:py-10">
        {children}
      </Container>
      {user && <SessionGuard userId={user.id} />}
    </>
  );
}
