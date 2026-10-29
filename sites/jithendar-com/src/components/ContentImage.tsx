import Image from "next/image";
import type { ComponentProps } from "react";
import { resolveImage } from "@/lib/media";

const frame = "my-8 h-auto w-full rounded-xl border border-line";

/** Shown in place of media that cannot be loaded, so the reader still gets its description. */
export function MediaUnavailable({ label, kind = "Image" }: { label?: string; kind?: string }) {
  return (
    <span role="img" aria-label={label ? `${kind} unavailable: ${label}` : `${kind} unavailable`} className="my-8 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface-muted p-4 text-center text-sm text-fg-subtle">
      {kind} unavailable{label ? `: ${label}` : ""}
    </span>
  );
}

/**
 * Markdown images (`![alt](/images/x.png)` or uploaded `/media/<id>/x.png`) rendered through next/image:
 * intrinsic size (no layout shift), AVIF/WebP at the width the layout needs (srcset + sizes) and
 * native lazy loading. SVGs are served as-is (scaled by CSS) since they are already resolution-independent.
 */
export async function ContentImage({ src, alt = "", title }: ComponentProps<"img">) {
  const image = typeof src === "string" ? await resolveImage(src) : undefined;
  // Remote images are never loaded (no third-party requests); missing ones show their alt text.
  if (!image) return <MediaUnavailable label={alt} />;
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
