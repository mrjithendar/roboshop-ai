import Image from "next/image";
import type { Article } from "@/lib/content";
import type { CategoryInfo } from "@/lib/categories";
import { toneFor } from "./categoryStyle";
import { CategoryIcon } from "./icons";

/**
 * A post's cover: the selected image (16:9 crop around its focal point, optimised AVIF/WebP at the
 * width `sizes` asks for, lazy unless `priority`), or a quiet placeholder with the category's glyph
 * so card grids stay uniform when a post has no cover. Only the one above-the-fold LCP card sets
 * `priority` (eager + high fetch priority).
 */
export function CoverImage({
  article,
  category,
  sizes,
  priority = false,
  className = "",
}: {
  article: Article;
  category?: CategoryInfo;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const cover = article.frontmatter.featuredImage;
  return (
    <div className={`relative aspect-[16/9] overflow-hidden bg-surface-sunken ${className}`}>
      {cover ? (
        <Image
          src={cover.src}
          alt={cover.alt}
          fill
          sizes={sizes}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="object-cover"
          style={{ objectPosition: `${cover.focalX ?? 50}% ${cover.focalY ?? 50}%` }}
        />
      ) : (
        <div className={`absolute inset-0 flex items-center justify-center ring-0 ${toneFor(category?.tone ?? "slate")}`} aria-hidden="true">
          <CategoryIcon name={category?.icon ?? "layers"} className="h-10 w-10 opacity-70" />
        </div>
      )}
    </div>
  );
}
