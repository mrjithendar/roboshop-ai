"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { GitHubIcon, GoogleIcon, LinkIcon } from "@/components/icons";
import { Alert, Button } from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { unlinkAccountAction } from "../actions";

type Row = { id: string; providerId: string; connectedAt: string };
type Provider = "google" | "github";

const names: Record<string, string> = { credential: "Email and password", google: "Google", github: "GitHub" };
const icons: Record<string, typeof GitHubIcon> = { google: GoogleIcon, github: GitHubIcon, credential: LinkIcon };

/**
 * Connect: Better Auth's linkSocial while signed in (OAuth with state + PKCE proves control of the other account).
 * Disconnect: server action → Better Auth unlink, which refuses the last sign-in method and stale sessions.
 */
export function ConnectedAccounts({ accounts, available, fresh }: { accounts: Row[]; available: Provider[]; fresh: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; reauth?: boolean } | null>(null);
  const [, start] = useTransition();
  const connected = new Set(accounts.map((a) => a.providerId));
  const connectable = available.filter((p) => !connected.has(p));
  const reauthHref = "/login?reauth=1&next=%2Faccount%2Fsettings";

  async function connect(provider: Provider) {
    setMessage(null);
    setBusy(provider);
    const { error } = await authClient.linkSocial({ provider, callbackURL: `/account/settings?linked=${provider}`, errorCallbackURL: "/account/settings" });
    if (error) {
      setBusy(null);
      const code = (error.code ?? "").toLowerCase();
      setMessage({ ok: false, text: authErrorMessage(code) ?? "Could not start connecting that account.", reauth: code === "session_not_fresh" });
    }
  }

  function disconnect(row: Row) {
    setMessage(null);
    setBusy(row.id);
    start(async () => {
      const r = await unlinkAccountAction(row.id);
      setBusy(null);
      if (r.ok) {
        setMessage({ ok: true, text: `${names[row.providerId] ?? row.providerId} disconnected.` });
        router.refresh();
      } else setMessage({ ok: false, text: r.error, reauth: (r.code ?? "").toUpperCase() === "SESSION_NOT_FRESH" });
    });
  }

  return (
    <div className="space-y-4">
      {!fresh && (
        <Alert tone="info">
          You signed in more than an hour ago. To connect or disconnect an account,{" "}
          <a href={reauthHref} className="link">
            sign in again
          </a>{" "}
          first.
        </Alert>
      )}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {accounts.map((row) => {
          const Icon = icons[row.providerId] ?? LinkIcon;
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Icon className="h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-medium text-fg">{names[row.providerId] ?? row.providerId}</p>
                <p className="text-sm text-fg-subtle">Connected {row.connectedAt}</p>
              </div>
              {accounts.length > 1 ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => disconnect(row)} loading={busy === row.id} disabled={busy !== null}>
                  Disconnect<span className="sr-only"> {names[row.providerId]}</span>
                </Button>
              ) : (
                <span className="basis-full pl-8 text-sm text-fg-subtle sm:basis-auto sm:pl-0">Only sign-in method</span>
              )}
            </li>
          );
        })}
        {connectable.map((p) => {
          const Icon = icons[p]!;
          return (
            <li key={p} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Icon className="h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-medium text-fg">{names[p]}</p>
                <p className="text-sm text-fg-subtle">Not connected</p>
              </div>
              <Button type="button" size="sm" onClick={() => connect(p)} loading={busy === p} disabled={busy !== null}>
                Connect<span className="sr-only"> {names[p]}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {message && (
        <Alert tone={message.ok ? "success" : "error"}>
          {message.text}
          {message.reauth && (
            <>
              {" "}
              <a href={reauthHref} className="link">
                Sign in again
              </a>
            </>
          )}
        </Alert>
      )}
    </div>
  );
}
