"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Turnstile } from "@/components/Turnstile";
import { Alert, Button, Field, Input } from "@/components/ui/form";
import { authClient, safeNext } from "@/lib/auth-client";
import { PASSWORD_HINT, PASSWORD_MIN, passwordProblem } from "@/lib/password-policy";

export function LoginForm({ siteKey, registrationOpen }: { siteKey: string | undefined; registrationOpen: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Please complete the human verification.");
      return;
    }
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const problem = mode === "signup" ? passwordProblem(password) : null;
    if (problem) {
      setError(problem);
      return;
    }
    const fetchOptions = { headers: { "x-captcha-response": token } };
    setBusy(true);
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password, fetchOptions })
        : await authClient.signUp.email({ email, password, name: String(form.get("name") ?? ""), fetchOptions });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Please try again.");
      setToken(null);
      setResetKey((k) => k + 1); // tokens are single-use
      return;
    }
    router.push(safeNext(params.get("next")));
    router.refresh();
  }

  if (!siteKey) return <Alert>Sign-in is unavailable: human verification is not configured.</Alert>;

  return (
    <div>
      {registrationOpen && (
        <div role="tablist" aria-label="Account" className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                mode === m ? "bg-white text-ink shadow-sm dark:bg-surface-dark-raised dark:text-white" : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="space-y-5" noValidate>
        {mode === "signup" && (
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint={mode === "signup" ? PASSWORD_HINT : undefined}>
          <Input id="password" name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signup" ? PASSWORD_MIN : 1} />
        </Field>
        <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
