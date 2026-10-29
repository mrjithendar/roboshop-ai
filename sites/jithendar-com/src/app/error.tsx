"use client";

import Link from "next/link";
import { Container } from "@/components/Container";
import { Button, buttonClass } from "@/components/ui/form";

/** Unexpected server or render errors. Shows no internals; the digest lets the editor find the log line. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container narrow className="py-20 text-center sm:py-28">
      <p className="font-mono text-sm font-semibold text-red-700 dark:text-red-300">Error</p>
      <h1 className="mt-3 text-title font-bold text-fg">Something went wrong</h1>
      <p className="mx-auto mt-4 max-w-md text-lg leading-8 text-fg-muted">The page could not be loaded. Try again, or come back in a few minutes.</p>
      {error.digest && <p className="mt-3 font-mono text-xs text-fg-subtle">Reference: {error.digest}</p>}
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonClass("secondary")}>
          Go to the homepage
        </Link>
      </div>
    </Container>
  );
}
