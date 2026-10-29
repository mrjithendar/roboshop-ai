import Image from "next/image";
import type { Article } from "@/lib/content";
import type { CategoryInfo } from "@/lib/categories";
import { toneFor } from "./categoryStyle";
import { CategoryIcon } from "./icons";

/**
 * A post's cover: the selected image (16:9 crop around its focal point, optimised AVIF/WebP at the
 * width `sizes` asks for, lazy unless `priority`), or a branded placeholder in the category's colour
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
    <div className={`relative aspect-[16/9] overflow-hidden bg-slate-100 dark:bg-white/5 ${className}`}>
      {cover ? (
        <Image
          src={cover.src}
          alt={cover.alt}
          fill
          sizes={sizes}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          style={{ objectPosition: `${cover.focalX ?? 50}% ${cover.focalY ?? 50}%` }}
        />
      ) : (
        <div className={`absolute inset-0 flex items-center justify-center ring-0 ${toneFor(category?.tone ?? "slate")}`} aria-hidden="true">
          <div className="bg-grid absolute inset-0 opacity-60" />
          <CategoryIcon name={category?.icon ?? "layers"} className="relative h-12 w-12 opacity-80" />
        </div>
      )}
    </div>
  );
}
