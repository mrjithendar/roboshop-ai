import Link from "next/link";
import { site } from "@/config/site";

/** Monogram on the accent colour. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--color-brand-600)" />
      <path d="M19.5 8v10.5a5 5 0 0 1-10 0" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-md" aria-label={`${site.name} home`}>
      <LogoMark className="h-7 w-7" />
      <span className="text-[1.0625rem] font-semibold tracking-tight text-fg">
        Jithendar<span className="text-fg-subtle max-[379px]:hidden">.com</span>
      </span>
    </Link>
  );
}
