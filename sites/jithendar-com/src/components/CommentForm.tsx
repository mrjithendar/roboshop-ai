"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { submitCommentAction } from "@/app/_actions/public";
import { Turnstile } from "@/components/Turnstile";
import { Alert, Button, Textarea } from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";

export function CommentForm({ postId, path, siteKey }: { postId: string; path: string; siteKey: string | undefined }) {
  const { data: session, isPending } = authClient.useSession();
  const [body, setBody] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (isPending) return null;
  if (!session) {
    return (
      <p className="rounded-xl border border-line p-4 text-sm">
        <Link href={`/login?next=${encodeURIComponent(path + "#comments")}`} className="font-semibold text-accent-text underline">
          Sign in
        </Link>{" "}
        to join the discussion.
      </p>
    );
  }
  if (!siteKey) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setResult({ ok: false, text: "Please complete the human verification." });
      return;
    }
    start(async () => {
      const r = await submitCommentAction(postId, body, token);
      setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      setToken(null);
      setResetKey((k) => k + 1);
      if (r.ok) setBody("");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="comment" className="block text-sm font-medium text-fg">
        Comment as {session.user.name}
      </label>
      <Textarea id="comment" rows={4} value={body} onChange={(e) => setBody(e.target.value)} minLength={2} maxLength={5000} required placeholder="Add to the discussion…" />
      <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} />
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.text}</Alert>}
      <Button type="submit" disabled={pending}>{pending ? "Posting…" : "Post comment"}</Button>
    </form>
  );
}
