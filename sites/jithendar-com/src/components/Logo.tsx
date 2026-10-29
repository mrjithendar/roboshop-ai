/* eslint-disable @next/next/no-img-element -- logos are small, sized explicitly and may be SVG files shipped with the site */
import Link from "next/link";
import type { ImageRef, SiteConfig } from "@/lib/site-config/schema";

/** Monogram on the accent colour (the default mark when no logo image is configured). */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--logo-bg, var(--color-brand-600))" />
      <path d="M19.5 8v10.5a5 5 0 0 1-10 0" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

const HEIGHTS = { sm: 24, md: 28, lg: 36 } as const;

function LogoImage({ image, height, className }: { image: ImageRef; height: number; className: string }) {
  const width = Math.round((image.width / image.height) * height);
  return <img src={image.src} alt="" width={width} height={height} style={{ height, width: "auto", maxWidth: 220 }} className={className} decoding="async" />;
}

/** Logo link: configured logo images (light/dark/mobile) or the monogram, plus the wordmark when enabled. */
export function Logo({ branding, siteName, size = "md" }: { branding: SiteConfig["branding"]; siteName: string; size?: keyof typeof HEIGHTS }) {
  const h = HEIGHTS[size];
  const { logoLight, logoDark, logoMobile, showWordmark } = branding;
  const [name, tld] = siteName.endsWith(".com") ? [siteName.slice(0, -4), ".com"] : [siteName, ""];
  return (
    <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-md" aria-label={`${siteName} home`}>
      {logoLight ? (
        <>
          {logoMobile && <LogoImage image={logoMobile} height={h} className="sm:hidden" />}
          <LogoImage image={logoLight} height={h} className={`${logoMobile ? "hidden sm:block" : ""} ${logoDark ? "dark:hidden" : ""}`} />
          {logoDark && <LogoImage image={logoDark} height={h} className={`hidden ${logoMobile ? "sm:dark:block" : "dark:block"}`} />}
        </>
      ) : (
        <LogoMark className={`shrink-0 ${size === "lg" ? "h-9 w-9" : size === "sm" ? "h-6 w-6" : "h-7 w-7"}`} />
      )}
      {(showWordmark || !logoLight) && (
        <span className="truncate font-semibold tracking-tight text-fg" style={{ fontSize: size === "lg" ? "1.25rem" : size === "sm" ? "1rem" : "1.0625rem" }}>
          {name}
          {tld && <span className="text-fg-subtle max-[379px]:hidden">{tld}</span>}
        </span>
      )}
    </Link>
  );
}
