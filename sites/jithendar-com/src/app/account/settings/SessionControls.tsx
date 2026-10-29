"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";
import { signOutEverywhereAction } from "../actions";

export function SessionControls() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"here" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function signOut(all: boolean) {
    setError(null);
    setWhich(all ? "all" : "here");
    start(async () => {
      if (all) {
        const r = await signOutEverywhereAction();
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }
      await authClient.signOut();
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => signOut(false)} loading={pending && which === "here"} disabled={pending}>
          Sign out
        </Button>
        <Button type="button" variant="secondary" onClick={() => signOut(true)} loading={pending && which === "all"} disabled={pending}>
          Sign out of all devices
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
