import { z } from "zod";
import {
  allowedTypes,
  contentTypeKeys,
  typesRequiringSources,
  type Collection,
} from "@/config/taxonomy";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case");

/** Slugs that would collide with listing routes (/blog/page/2, /blog/feed.xml). */
const RESERVED_SLUGS = new Set(["page", "feed", "category", "tag"]);
const articleSlug = slug.refine((s) => !RESERVED_SLUGS.has(s), "is reserved for a route");

/** Explicit related article, written as "<collection>/<slug>". */
const relatedRef = z.string().regex(/^(blog|news|projects)\/[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must look like "blog/my-post"');

/** ISO 8601 date-time that carries an explicit offset (Z or ±hh:mm). */
export const isoDateTime = z.iso.datetime({ offset: true, local: false });

const source = z.strictObject({
  title: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  publisher: z.string().min(1),
});

const featuredImage = z.strictObject({
  src: z
    .string()
    .regex(/^(\/images\/[^?#]+\.(jpe?g|png|webp|avif)|\/media\/[0-9a-f-]{36}\/[^/?#]+)$/i, "must be a /images/... file or an uploaded /media/... image"),
  alt: z.string().min(1, "alt text is required"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Focal point (0–100 %) kept in view when the cover is cropped; default centre. */
  focalX: z.number().min(0).max(100).optional(),
  focalY: z.number().min(0).max(100).optional(),
});

export const articleFrontmatter = z
  .strictObject({
    title: z.string().min(10).max(110),
    slug: articleSlug,
    description: z.string().min(50).max(160),
    author: slug,
    // Existence is checked against the live category list by the loader / post service.
    category: slug,
    tags: z
      .array(z.string().trim().min(1))
      .default([])
      .transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()))]),
    contentType: z.enum(contentTypeKeys),
    status: z.enum(["draft", "review", "published", "archived"]),
    publishedAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
    canonicalUrl: z.url({ protocol: /^https$/ }).optional(),
    featuredImage: featuredImage.optional(),
    sources: z.array(source).default([]),
    corrections: z.array(z.strictObject({ date: isoDateTime, note: z.string().min(1) })).default([]),
    sponsored: z.boolean().default(false),
    sponsor: z.string().min(1).optional(),
    related: z.array(relatedRef).default([]),
  })
  .superRefine((fm, ctx) => {
    if (fm.status === "published" && !fm.publishedAt) {
      ctx.addIssue({ code: "custom", path: ["publishedAt"], message: "required when status is published" });
    }
    if (fm.updatedAt && !fm.publishedAt) {
      ctx.addIssue({ code: "custom", path: ["updatedAt"], message: "requires publishedAt" });
    }
    if (fm.updatedAt && fm.publishedAt && Date.parse(fm.updatedAt) < Date.parse(fm.publishedAt)) {
      ctx.addIssue({ code: "custom", path: ["updatedAt"], message: "must be on or after publishedAt" });
    }
    if (typesRequiringSources.includes(fm.contentType) && fm.sources.length === 0) {
      ctx.addIssue({ code: "custom", path: ["sources"], message: `at least one source is required for ${fm.contentType}` });
    }
    if (fm.sponsored && !fm.sponsor) {
      ctx.addIssue({ code: "custom", path: ["sponsor"], message: "required when sponsored is true" });
    }
    if (!fm.sponsored && fm.sponsor) {
      ctx.addIssue({ code: "custom", path: ["sponsored"], message: "must be true when sponsor is set" });
    }
  });

export type ArticleFrontmatter = z.output<typeof articleFrontmatter>;

/** Collection-specific rule layered on top of the shared schema. */
export function collectionSchema(collection: Collection) {
  return articleFrontmatter.superRefine((fm, ctx) => {
    if (!allowedTypes[collection].includes(fm.contentType)) {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: `"${fm.contentType}" is not allowed in ${collection} (allowed: ${allowedTypes[collection].join(", ")})`,
      });
    }
  });
}

export const authorFrontmatter = z.strictObject({
  name: z.string().min(1),
  slug,
  jobTitle: z.string().min(1).optional(),
  url: z.url({ protocol: /^https$/ }).optional(),
  sameAs: z.array(z.url({ protocol: /^https$/ })).default([]),
});

export type AuthorFrontmatter = z.output<typeof authorFrontmatter>;

/** Standalone site pages (about, policies) in content/pages/. */
export const pageFrontmatter = z.strictObject({
  title: z.string().min(2).max(110),
  slug,
  description: z.string().min(50).max(160),
  updatedAt: isoDateTime.optional(),
});

export type PageFrontmatter = z.output<typeof pageFrontmatter>;
