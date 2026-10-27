import Link from "next/link";
import { Container } from "@/components/Container";

export default function NotFound() {
  return (
    <div className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <Container narrow className="relative py-28 text-center">
        <p className="font-mono text-sm font-semibold text-brand-700 dark:text-brand-300">404</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl dark:text-white">Page not found</h1>
        <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">The page you are looking for does not exist or has moved.</p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/" className="inline-flex items-center justify-center rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-ink dark:hover:bg-slate-200">
            Go to the homepage
          </Link>
          <Link href="/search" className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-ink hover:border-slate-400 dark:border-white/15 dark:text-white">
            Search the site
          </Link>
        </div>
      </Container>
    </div>
  );
}
