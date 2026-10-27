import Image from "next/image";
import type { ComponentProps } from "react";
import { resolveImage } from "@/lib/media";

const frame = "my-8 h-auto w-full rounded-xl border border-slate-200 dark:border-white/10";

/**
 * Markdown images (`![alt](/images/x.png)` or uploaded `/media/<id>/x.png`) rendered through next/image:
 * intrinsic size (no layout shift), AVIF/WebP, responsive sizes and native lazy loading.
 */
export async function ContentImage({ src, alt = "", title }: ComponentProps<"img">) {
  const image = typeof src === "string" ? await resolveImage(src) : undefined;
  // Remote or missing images render nothing: no third-party requests, no broken frames.
  if (!image) return null;
  return (
    <Image
      src={image.src}
      alt={alt}
      title={title}
      width={image.width}
      height={image.height}
      sizes="(min-width: 1024px) 768px, 100vw"
      loading="lazy"
      unoptimized={image.svg}
      className={frame}
    />
  );
}
