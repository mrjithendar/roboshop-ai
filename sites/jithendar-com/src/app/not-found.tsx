import Link from "next/link";
import { Container } from "@/components/Container";
import { buttonClass } from "@/components/ui/form";

export default function NotFound() {
  return (
    <Container narrow className="py-20 text-center sm:py-28">
      <p className="font-mono text-sm font-semibold text-accent-text">404</p>
      <h1 className="mt-3 text-title font-bold text-fg">Page not found</h1>
      <p className="mx-auto mt-4 max-w-md text-lg leading-8 text-fg-muted">The page you are looking for does not exist or has moved.</p>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <Link href="/" className={buttonClass("primary")}>
          Go to the homepage
        </Link>
        <Link href="/search" className={buttonClass("secondary")}>
          Search the site
        </Link>
      </div>
    </Container>
  );
}
