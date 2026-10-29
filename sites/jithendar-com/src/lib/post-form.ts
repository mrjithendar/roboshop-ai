import type { FeaturedImage, Source } from "@/db/schema";
import { toIsoOffset } from "./dates-iso";

/** What the post editor edits. Also the payload of autosaves and what revisions are restored into. */
export type PostFormValue = {
  collection: "blog" | "news" | "projects";
  slug: string;
  title: string;
  description: string;
  body: string;
  category: string;
  tags: string[];
  contentType: string;
  status: "draft" | "review" | "scheduled" | "published" | "archived";
  publishedAt: string | null;
  updatedAt: string | null;
  canonicalUrl: string | null;
  featuredImage: FeaturedImage | null;
  sources: Source[];
  sponsored: boolean;
  sponsor: string | null;
  related: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  socialTitle: string | null;
  socialDescription: string | null;
  socialImage: FeaturedImage | null;
  noindex: boolean;
};

type RowLike = Record<string, unknown>;

const date = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : toIsoOffset(d);
};
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A post row (live) or a revision payload (JSON, dates as strings) → editor value. */
export function rowToForm(row: RowLike): PostFormValue {
  return {
    collection: (row.collection as PostFormValue["collection"]) ?? "blog",
    slug: String(row.slug ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    body: String(row.body ?? ""),
    category: String(row.category ?? ""),
    tags: (row.tags as string[]) ?? [],
    contentType: String(row.contentType ?? row.content_type ?? "tutorial"),
    status: (row.status as PostFormValue["status"]) ?? "draft",
    publishedAt: date(row.publishedAt ?? row.published_at),
    updatedAt: date(row.updatedAt ?? row.updated_at),
    canonicalUrl: str(row.canonicalUrl ?? row.canonical_url),
    featuredImage: (row.featuredImage ?? row.featured_image ?? null) as FeaturedImage | null,
    sources: (row.sources as Source[]) ?? [],
    sponsored: row.sponsored === true,
    sponsor: str(row.sponsor),
    related: (row.related as string[]) ?? [],
    seoTitle: str(row.seoTitle ?? row.seo_title),
    seoDescription: str(row.seoDescription ?? row.seo_description),
    socialTitle: str(row.socialTitle ?? row.social_title),
    socialDescription: str(row.socialDescription ?? row.social_description),
    socialImage: (row.socialImage ?? row.social_image ?? null) as FeaturedImage | null,
    noindex: (row.noindex as boolean) ?? false,
  };
}
