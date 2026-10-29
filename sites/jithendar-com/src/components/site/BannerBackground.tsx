import Image from "next/image";
import type { Banner, ImageRef } from "@/lib/site-config/schema";

function Layer({ image, className, sizes, priority }: { image: ImageRef; className: string; sizes: string; priority: boolean }) {
  return (
    <Image
      src={image.src}
      alt={image.decorative ? "" : image.alt}
      aria-hidden={image.decorative || undefined}
      fill
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      className={`${className} ${image.fit === "contain" ? "object-contain" : "object-cover"}`}
      style={{ objectPosition: `${image.focalX}% ${image.focalY}%` }}
    />
  );
}

/**
 * A configured background image (desktop, optional mobile crop below 640px) with its overlay, filling the
 * nearest positioned ancestor. Images go through next/image (responsive AVIF/WebP variants from our media).
 */
export function BannerBackground({ banner, priority = false, sizes = "100vw" }: { banner: Banner; priority?: boolean; sizes?: string }) {
  if (!banner.desktop) return null;
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <Layer image={banner.desktop} className={banner.mobile ? "hidden sm:block" : ""} sizes={sizes} priority={priority} />
      {banner.mobile && <Layer image={banner.mobile} className="sm:hidden" sizes="100vw" priority={priority} />}
      <div className="absolute inset-0" style={{ backgroundColor: banner.overlayColor, opacity: banner.overlayOpacity / 100 }} aria-hidden="true" />
    </div>
  );
}
