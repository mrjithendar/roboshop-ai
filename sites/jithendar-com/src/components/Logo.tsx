import Link from "next/link";
import { site } from "@/config/site";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="oklch(0.51 0.21 277)" />
          <stop offset="1" stopColor="oklch(0.7 0.14 220)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
      <path d="M19.5 8v10.5a5 5 0 0 1-10 0" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md" aria-label={`${site.name} home`}>
      <LogoMark />
      <span className="text-[1.05rem] font-semibold tracking-tight text-ink dark:text-white">
        Jithendar<span className="text-brand-600 dark:text-brand-300">.com</span>
      </span>
    </Link>
  );
}
