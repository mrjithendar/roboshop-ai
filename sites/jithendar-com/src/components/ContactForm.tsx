"use client";

import { useState, useTransition } from "react";
import { submitContactAction } from "@/app/_actions/public";
import { Turnstile } from "@/components/Turnstile";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui/form";

export function ContactForm({ siteKey }: { siteKey: string | undefined }) {
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(null);
  const [pending, start] = useTransition();
  if (!siteKey) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as { name: string; email: string; subject: string; message: string };
    if (!token) {
      setResult({ ok: false, text: "Please complete the human verification." });
      return;
    }
    start(async () => {
      const r = await submitContactAction(data, token);
      setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error, issues: r.issues });
      setToken(null);
      setResetKey((k) => k + 1);
      if (r.ok) form.reset();
    });
  }

  return (
    <section aria-labelledby="contact-form-title" className="mt-12 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-8">
      <h2 id="contact-form-title" className="text-xl font-semibold text-fg">Send a message</h2>
      <form onSubmit={submit} className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="c-name"><Input id="c-name" name="name" autoComplete="name" required maxLength={100} /></Field>
        <Field label="Email" htmlFor="c-email"><Input id="c-email" name="email" type="email" autoComplete="email" required maxLength={200} /></Field>
        <div className="sm:col-span-2"><Field label="Subject" htmlFor="c-subject"><Input id="c-subject" name="subject" required maxLength={150} /></Field></div>
        <div className="sm:col-span-2"><Field label="Message" htmlFor="c-message"><Textarea id="c-message" name="message" rows={6} required minLength={10} maxLength={5000} /></Field></div>
        <div className="sm:col-span-2 space-y-4">
          <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} />
          {result && (
            <Alert tone={result.ok ? "success" : "error"}>
              {result.text}
              {result.issues && <ul className="mt-1 list-disc pl-5">{result.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            </Alert>
          )}
          <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send message"}</Button>
          <p className="text-xs text-slate-500">Your message is stored securely and read only by the editor. See the privacy policy.</p>
        </div>
      </form>
    </section>
  );
}
