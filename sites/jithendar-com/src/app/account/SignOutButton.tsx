"use client";

import { useState } from "react";
import { Button } from "@/components/ui/form";
import { signOutAndLeave } from "@/lib/sign-out";

export function SignOutButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          // On success the browser is already loading the sign-in page; only failures return here.
          const message = await signOutAndLeave();
          setBusy(false);
          setError(message);
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
